// Build: xcrun swiftc -parse-as-library -O -module-cache-path /tmp/gs-ai-swift-module-cache scripts/render_home_shopping.swift -o /tmp/render_home_shopping
// Run: /tmp/render_home_shopping <rootDir> <planJson> <outputMp4> [--preview]
// Full mode: 120 seconds / 12 scenes. Explicit --preview: 10 seconds / one scene.
// Both modes require matching-duration 25-fps animated host footage; never substitute stills.
import Foundation
import AppKit
import AVFoundation
import CoreGraphics
import CoreVideo
import ImageIO
import UniformTypeIdentifiers
import AudioToolbox

struct Scene: Decodable {
    let id: String
    let start_s: Double
    let duration_s: Double
    let title: String
    let kicker: String
    let caption_lines: [String]
    let narration: String
    let label: String
    let images: [String]
    let image_labels: [String]?
    let audio_start_s: Double
    let audio_end_s: Double
    let layout: String
}

struct RenderPlan: Decodable {
    let width: Int
    let height: Int
    let fps: Int
    let duration_s: Double
    let audio_path: String
    let host_video_path: String
    let persistent_label: String
    let scenes: [Scene]
}

enum RenderError: Error, CustomStringConvertible {
    case message(String)
    var description: String {
        switch self { case .message(let text): return text }
    }
}

func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw RenderError.message(message) }
}

func color(_ hex: UInt32, alpha: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255,
            green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: alpha)
}

enum Palette {
    static let background = color(0xF5F0E9)
    static let ink = color(0x192B2A)
    static let muted = color(0x647470)
    static let accent = color(0x006A52)
    static let pale = color(0xE1EEE5)
    static let border = color(0xDEE6E1)
    static let white = NSColor.white
    static let warning = color(0x975728)
}

// All public layout coordinates are measured from the top left. CoreGraphics
// and AppKit text share an unflipped native context, avoiding inverted glyphs.
@MainActor
final class Canvas {
    let width: Int
    let height: Int
    let context: CGContext

    init(width: Int, height: Int, context: CGContext? = nil) throws {
        self.width = width
        self.height = height
        let bitmapInfo = CGBitmapInfo.byteOrder32Little.rawValue |
            CGImageAlphaInfo.premultipliedFirst.rawValue
        guard let target = context ?? CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8,
            bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: bitmapInfo
        ) else { throw RenderError.message("Cannot allocate bitmap context") }
        self.context = target
        target.interpolationQuality = .high
        target.setShouldAntialias(true)
        if context == nil { target.clear(CGRect(x: 0, y: 0, width: width, height: height)) }
    }

    func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> CGRect {
        CGRect(x: x, y: CGFloat(height) - y - h, width: w, height: h)
    }

    func fill(_ fill: NSColor) {
        context.setFillColor(fill.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    }

    func box(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat,
             radius: CGFloat = 0, fill: NSColor, stroke: NSColor? = nil) {
        let shape = CGPath(roundedRect: rect(x, y, w, h), cornerWidth: radius,
                           cornerHeight: radius, transform: nil)
        context.addPath(shape)
        context.setFillColor(fill.cgColor)
        if let stroke {
            context.setStrokeColor(stroke.cgColor)
            context.setLineWidth(1)
            context.drawPath(using: .fillStroke)
        } else { context.fillPath() }
    }

    func text(_ text: String, x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat,
              size: CGFloat = 28, minSize: CGFloat? = nil,
              bold: Bool = false, fill: NSColor = Palette.ink,
              alignment: NSTextAlignment = .left, monospaced: Bool = false) {
        let style = NSMutableParagraphStyle()
        style.alignment = alignment
        style.lineBreakMode = .byWordWrapping
        style.lineSpacing = 5
        var chosen = size
        var attributed = NSAttributedString()
        while true {
            let font: NSFont
            if monospaced {
                font = .monospacedDigitSystemFont(ofSize: chosen, weight: bold ? .bold : .medium)
            } else {
                font = NSFont(name: bold ? "AppleSDGothicNeo-Bold" : "AppleSDGothicNeo-Medium", size: chosen)
                    ?? .systemFont(ofSize: chosen, weight: bold ? .bold : .medium)
            }
            attributed = NSAttributedString(string: text, attributes: [
                .font: font, .foregroundColor: fill, .paragraphStyle: style
            ])
            let bounds = attributed.boundingRect(
                with: CGSize(width: width, height: 10000),
                options: [.usesLineFragmentOrigin, .usesFontLeading]
            )
            if bounds.height <= height || chosen <= (minSize ?? size) { break }
            chosen -= 1
        }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
        attributed.draw(with: rect(x, y, width, height),
                        options: [.usesLineFragmentOrigin, .usesFontLeading])
        NSGraphicsContext.restoreGraphicsState()
    }

    func contain(_ image: CGImage, x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat) {
        let scale = min(width / CGFloat(image.width), height / CGFloat(image.height))
        let w = CGFloat(image.width) * scale
        let h = CGFloat(image.height) * scale
        context.draw(image, in: rect(x + (width - w) / 2, y + (height - h) / 2, w, h))
    }

    func image() throws -> CGImage {
        guard let image = context.makeImage() else { throw RenderError.message("Bitmap snapshot failed") }
        return image
    }
}

struct HostPlacement {
    let x: CGFloat
    let y: CGFloat
    let width: CGFloat
    let height: CGFloat
}

struct SceneLayers {
    let background: CGImage
    let subtitle: CGImage
    let facts: CGImage
    let host: HostPlacement
}

@MainActor
func measuredTextHeight(_ text: String, width: CGFloat, size: CGFloat, bold: Bool = false) -> CGFloat {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineBreakMode = .byWordWrapping
    paragraph.lineSpacing = 5
    let font = NSFont(name: bold ? "AppleSDGothicNeo-Bold" : "AppleSDGothicNeo-Medium", size: size)
        ?? .systemFont(ofSize: size, weight: bold ? .bold : .medium)
    return ceil(NSAttributedString(string: text, attributes: [.font: font, .paragraphStyle: paragraph])
        .boundingRect(with: CGSize(width: width, height: 10000),
                      options: [.usesLineFragmentOrigin, .usesFontLeading]).height)
}

func resolvePath(_ path: String, root: URL) -> URL {
    path.hasPrefix("/") ? URL(fileURLWithPath: path).standardizedFileURL
        : root.appendingPathComponent(path).standardizedFileURL
}

@MainActor
final class HomeShoppingDesign {
    let root: URL
    let plan: RenderPlan
    private var images: [String: CGImage] = [:]
    init(root: URL, plan: RenderPlan) { self.root = root; self.plan = plan }

    func sourceImage(_ path: String) throws -> CGImage {
        if let image = images[path] { return image }
        guard let source = CGImageSourceCreateWithURL(resolvePath(path, root: root) as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
        else { throw RenderError.message("Missing or invalid product image: \(path)") }
        images[path] = image
        return image
    }

    func imageLabel(_ scene: Scene, index: Int) -> String {
        let isAI = scene.images[index].contains("lookbooks/")
        let supplied = scene.image_labels.flatMap { $0.indices.contains(index) ? $0[index] : nil } ?? ""
        let required = isAI ? "AI 코디 예시" : "실제 상품 이미지"
        if supplied.isEmpty { return required }
        // Avoid redundant long labels such as "실제 상품 이미지 · 실제 판매 상품 이미지".
        if isAI { return supplied.contains(required) ? supplied : "\(required) · \(supplied)" }
        return supplied.contains("실제") ? supplied : "\(required) · \(supplied)"
    }

    func productImage(_ canvas: Canvas, scene: Scene, index: Int,
                      x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat) throws {
        // A broadcast product window, with no crop or alteration of its source image.
        canvas.box(x, y, width, height, fill: .white)
        canvas.contain(try sourceImage(scene.images[index]), x: x + 8, y: y + 8,
                       width: width - 16, height: height - 82)
        let isAI = scene.images[index].contains("lookbooks/")
        canvas.box(x, y + height - 70, width, 70,
                   fill: isAI ? Palette.accent : color(0xE9E7E3))
        let label = imageLabel(scene, index: index)
        let labelHeight = measuredTextHeight(label, width: width - 24, size: 24, bold: true)
        try require(labelHeight <= 64, "Image label exceeds two 24px lines in scene \(scene.id): \(label)")
        canvas.text(label, x: x + 12, y: y + height - 70 + (70 - labelHeight) / 2,
                    width: width - 24, height: labelHeight + 1, size: 24, minSize: 24,
                    bold: true, fill: isAI ? .white : Palette.ink, alignment: .center)
    }

    func productGroup(_ canvas: Canvas, scene: Scene,
                      x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat) throws {
        let count = scene.images.count
        if count == 1 {
            try productImage(canvas, scene: scene, index: 0, x: x, y: y, width: width, height: height)
        } else if count == 4 {
            let gap: CGFloat = 12
            let w = (width - gap) / 2
            let h = (height - gap) / 2
            for i in 0..<4 {
                try productImage(canvas, scene: scene, index: i,
                                 x: x + CGFloat(i % 2) * (w + gap), y: y + CGFloat(i / 2) * (h + gap),
                                 width: w, height: h)
            }
        } else {
            let w = (width - CGFloat(count - 1) * 12) / CGFloat(count)
            for i in 0..<count {
                try productImage(canvas, scene: scene, index: i, x: x + CGFloat(i) * (w + 12),
                                 y: y, width: w, height: height)
            }
        }
    }

    func makeScene(_ scene: Scene) throws -> SceneLayers {
        let canvas = try Canvas(width: plan.width, height: plan.height)
        canvas.fill(Palette.background)
        // Network bug and persistent synthetic-host disclosure, above all face regions.
        canvas.box(0, 0, 1920, 82, fill: .white)
        canvas.text("GS AI LIVE", x: 40, y: 22, width: 240, height: 45, size: 31, bold: true, fill: Palette.accent)
        canvas.box(292, 22, 164, 39, radius: 3, fill: color(0xBB3435))
        canvas.text("DEMO LIVE", x: 299, y: 27, width: 150, height: 30, size: 24,
                    bold: true, fill: .white, alignment: .center)
        canvas.text(plan.persistent_label, x: 970, y: 24, width: 906, height: 40,
                    size: 27, minSize: 24, bold: true, fill: Palette.ink, alignment: .right)
        canvas.box(0, 81, 1920, 3, fill: Palette.accent)

        let host: HostPlacement
        switch scene.layout {
        case "host_product":
            host = HostPlacement(x: 34, y: 98, width: 1000, height: 690)
            canvas.box(host.x, host.y, host.width, host.height, fill: color(0xEEE6DC))
            canvas.text(scene.kicker, x: 1090, y: 109, width: 774, height: 38,
                        size: 25, minSize: 22, bold: true, fill: Palette.accent)
            canvas.text(scene.title, x: 1090, y: 155, width: 774, height: 103,
                        size: 49, minSize: 39, bold: true)
            try productGroup(canvas, scene: scene, x: 1090, y: 269, width: 774, height: 489)
            canvas.text(scene.label, x: 1090, y: 763, width: 774, height: 31,
                        size: 24, minSize: 24, fill: Palette.muted)
        case "product_focus":
            host = HostPlacement(x: 1324, y: 174, width: 548, height: 574)
            canvas.box(host.x, host.y, host.width, host.height, fill: color(0xEEE6DC))
            canvas.text(scene.kicker, x: 48, y: 104, width: 540, height: 33,
                        size: 24, minSize: 21, bold: true, fill: Palette.accent)
            canvas.text(scene.title, x: 48, y: 144, width: 1208, height: 71,
                        size: 47, minSize: 37, bold: true)
            try productGroup(canvas, scene: scene, x: 48, y: 226, width: 1220, height: 542)
            canvas.text(scene.label, x: 1324, y: 99, width: 548, height: 66,
                        size: 24, minSize: 24, fill: Palette.muted, alignment: .center)
        case "styling":
            host = HostPlacement(x: 838, y: 242, width: 565, height: 526)
            canvas.box(host.x, host.y, host.width, host.height, fill: color(0xEEE6DC))
            try productImage(canvas, scene: scene, index: 0, x: 48, y: 100, width: 744, height: 688)
            canvas.text(scene.kicker, x: 838, y: 110, width: 1034, height: 36,
                        size: 25, minSize: 22, bold: true, fill: Palette.accent)
            canvas.text(scene.title, x: 838, y: 157, width: 1034, height: 69,
                        size: 48, minSize: 39, bold: true)
            try productImage(canvas, scene: scene, index: 1, x: 1440, y: 242, width: 432, height: 261)
            try productImage(canvas, scene: scene, index: 2, x: 1440, y: 517, width: 432, height: 261)
            // AI provenance is already shown in the 24px label under the Lookbook;
            // duplicating it beneath the host would collide with the fact strip.
        default:
            throw RenderError.message("Unsupported layout: \(scene.layout)")
        }

        // Product facts occupy a strip below the host's frame, never across a face.
        let facts = try Canvas(width: 1808, height: 33)
        facts.text(scene.caption_lines.joined(separator: "   ·   "), x: 0, y: 1,
                   width: 1808, height: 31, size: 24, minSize: 18, bold: true,
                   fill: Palette.ink, alignment: .center)
        // Narration appears only inside its supplied audio interval.
        let subtitle = try Canvas(width: 1832, height: 108)
        subtitle.box(0, 0, 1832, 108, radius: 7, fill: color(0x1E2825, alpha: 0.94))
        let narrationHeight = measuredTextHeight(scene.narration, width: 1782, size: 40)
        try require(narrationHeight <= 102, "Narration exceeds two 40px lines in scene \(scene.id)")
        subtitle.text(scene.narration, x: 25, y: (108 - narrationHeight) / 2,
                      width: 1782, height: narrationHeight + 1,
                      size: 40, minSize: 40, fill: .white, alignment: .center)

        // Persistent commerce lower third; prices are explicitly dated snapshots.
        canvas.box(0, 944, 1920, 136, fill: .white)
        canvas.box(0, 941, 1920, 3, fill: Palette.accent)
        canvas.box(0, 944, 240, 136, fill: Palette.accent)
        canvas.text("SJ WANI", x: 24, y: 975, width: 192, height: 43,
                    size: 34, bold: true, fill: .white, alignment: .center)
        canvas.text("캐시미어 풀오버", x: 17, y: 1024, width: 206, height: 27,
                    size: 20, fill: .white, alignment: .center)
        canvas.text("SJ와니 샤이니 크리즈 캐시미어 풀오버 1종",
                    x: 276, y: 963, width: 1130, height: 47, size: 35, minSize: 31, bold: true)
        canvas.text("사이즈 55 · 66 · 77 · 88   |   그레이 66 확인 당시 일시품절",
                    x: 278, y: 1017, width: 1130, height: 31, size: 24, minSize: 24, fill: Palette.muted)
        let priceScope = scene.layout == "styling"
            ? "가격은 메인 상의 1종 기준 · 코디 하의·신발 별도"
            : "현재 가격·옵션 재고는 실제 상품 페이지에서 확인"
        canvas.text(priceScope, x: 278, y: 1048, width: 1130, height: 31,
                    size: 24, fill: Palette.muted)
        canvas.text("메인 상의 1종", x: 1440, y: 949, width: 432, height: 29,
                    size: 24, bold: true, fill: Palette.accent, alignment: .right)
        canvas.text("49,900원", x: 1440, y: 979, width: 432, height: 64,
                    size: 53, minSize: 53, bold: true, fill: Palette.accent, alignment: .right)
        canvas.text("판매가 · 2026.09.21 확인", x: 1440, y: 1045, width: 432, height: 29,
                    size: 24, fill: Palette.muted, alignment: .right)
        return try SceneLayers(background: canvas.image(), subtitle: subtitle.image(), facts: facts.image(), host: host)
    }
}

// Sequential decoding holds at most two CMSampleBuffers. The host timeline is
// sampled directly at output time; there is no looping, time remapping, or still fallback.
@MainActor
final class HostFrameStream {
    let reader: AVAssetReader
    let output: AVAssetReaderTrackOutput
    let transform: CGAffineTransform
    let sourceDuration: Double
    let sourceFPS: Double
    let sourceSize: CGSize
    let sourceURL: URL
    private var current: CMSampleBuffer?
    private var upcoming: CMSampleBuffer?
    private var previousDecodedPTS: Double?
    private var previousRequestedTime: Double = -1
    private var previousSignature: UInt64?
    private(set) var decodedFrames = 0
    private(set) var sampledFrames = 0
    private(set) var changedSampledFrames = 0
    private(set) var largestSampleSkew: Double = 0
    private(set) var sampledTimestamps: [[String: Double]] = []
    let frameDuration: Double

    init(url: URL, duration: Double, fps: Int) async throws {
        sourceURL = url
        try require(FileManager.default.fileExists(atPath: url.path),
                    "Animated host video is missing: \(url.path). Still-image fallback is forbidden.")
        let asset = AVURLAsset(url: url)
        guard let track = try await asset.loadTracks(withMediaType: .video).first else {
            throw RenderError.message("Host source has no video track; a still image is not a host video")
        }
        sourceDuration = CMTimeGetSeconds(try await asset.load(.duration))
        sourceFPS = Double(try await track.load(.nominalFrameRate))
        sourceSize = try await track.load(.naturalSize)
        transform = try await track.load(.preferredTransform)
        frameDuration = 1 / Double(fps)
        try require(sourceDuration.isFinite && sourceDuration >= duration - 0.001,
                    "Host video is \(sourceDuration)s; a complete \(duration)s animated source is required. No freeze or loop fallback.")
        try require(abs(sourceFPS - Double(fps)) < 0.01,
                    "Host video must be \(fps) fps to preserve its narration timeline; found \(sourceFPS)")
        try require(sourceSize.width >= 128 && sourceSize.height >= 128, "Host source dimensions are invalid")
        reader = try AVAssetReader(asset: asset)
        reader.timeRange = CMTimeRange(start: .zero, duration: CMTime(seconds: duration, preferredTimescale: 600))
        output = AVAssetReaderTrackOutput(track: track, outputSettings: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferCGImageCompatibilityKey as String: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
        ])
        output.alwaysCopiesSampleData = false
        try require(reader.canAdd(output), "Cannot decode host video as BGRA")
        reader.add(output)
        try require(reader.startReading(), "Host reader failed: \(String(describing: reader.error))")
        current = try readSample()
        upcoming = try readSample()
        guard let current else { throw RenderError.message("Animated host source decoded zero frames") }
        try require(abs(CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(current))) < frameDuration * 0.5,
                    "Host source must begin at presentation time 0")
    }

    private func readSample() throws -> CMSampleBuffer? {
        guard let sample = output.copyNextSampleBuffer() else {
            if reader.status == .failed || reader.status == .cancelled {
                throw RenderError.message("Host decoding failed: \(String(describing: reader.error))")
            }
            return nil
        }
        let pts = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))
        try require(pts.isFinite, "Host frame has an invalid presentation timestamp")
        if let previousDecodedPTS {
            let gap = pts - previousDecodedPTS
            try require(gap > 0 && gap <= frameDuration * 1.5,
                        "Host timeline contains a duplicate, backwards or missing frame at \(pts)s (gap \(gap)s)")
        }
        previousDecodedPTS = pts
        decodedFrames += 1
        return sample
    }

    func draw(at time: Double, canvas: Canvas, placement: HostPlacement) throws {
        try require(time > previousRequestedTime, "Host sampler expects monotonically increasing output timestamps")
        previousRequestedTime = time
        // At exactly matching FPS every output advances to its corresponding source frame.
        while let candidate = upcoming,
              CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(candidate)) <= time + 0.0001 {
            current = candidate
            upcoming = try readSample()
        }
        guard let current, let buffer = CMSampleBufferGetImageBuffer(current) else {
            throw RenderError.message("Host has no image buffer at \(time)s")
        }
        let sourcePTS = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(current))
        let skew = abs(sourcePTS - time)
        try require(skew <= frameDuration * 0.5,
                    "Host source ended early or is misaligned at \(time)s; latest frame is \(sourcePTS)s. Refusing a frozen-frame fallback.")
        largestSampleSkew = max(largestSampleSkew, skew)
        sampledFrames += 1
        if sampledFrames == 1 || sampledFrames % 250 == 0 {
            sampledTimestamps.append(["output_time_s": time, "source_time_s": sourcePTS])
        }
        try require(CVPixelBufferLockBaseAddress(buffer, .readOnly) == kCVReturnSuccess,
                    "Cannot lock decoded host frame")
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        let width = CVPixelBufferGetWidth(buffer), height = CVPixelBufferGetHeight(buffer)
        guard let base = CVPixelBufferGetBaseAddress(buffer) else { throw RenderError.message("Host buffer has no pixel storage") }
        let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
        // Small content signature is only a sanity check against an entirely static MP4.
        let bytes = base.assumingMemoryBound(to: UInt8.self)
        var signature: UInt64 = 1469598103934665603
        for row in stride(from: 0, to: height, by: max(1, height / 32)) {
            for column in stride(from: 0, to: width, by: max(1, width / 32)) {
                let offset = row * bytesPerRow + column * 4
                for channel in 0..<3 { signature = (signature ^ UInt64(bytes[offset + channel])) &* 1099511628211 }
            }
        }
        if let previousSignature, previousSignature != signature { changedSampledFrames += 1 }
        previousSignature = signature
        let bitmapInfo = CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue
        guard let context = CGContext(data: base, width: width, height: height, bitsPerComponent: 8,
                                      bytesPerRow: bytesPerRow, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: bitmapInfo),
              let image = context.makeImage()
        else { throw RenderError.message("Cannot create a CGImage from the moving host frame") }
        if transform.isIdentity {
            canvas.contain(image, x: placement.x, y: placement.y, width: placement.width, height: placement.height)
        } else {
            let bounds = CGRect(x: 0, y: 0, width: width, height: height).applying(transform).standardized
            let oriented = try Canvas(width: Int(abs(bounds.width).rounded()), height: Int(abs(bounds.height).rounded()))
            oriented.context.translateBy(x: -bounds.minX, y: -bounds.minY)
            oriented.context.concatenate(transform)
            oriented.context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            canvas.contain(try oriented.image(), x: placement.x, y: placement.y, width: placement.width, height: placement.height)
        }
    }

    func finish(expectedFrames: Int) throws {
        try require(sampledFrames == expectedFrames, "Not every output frame received a host video frame")
        try require(changedSampledFrames > 0, "Host MP4 is entirely static; moving virtual-host footage is required")
        reader.cancelReading()
    }
}

func fourCC(_ code: FourCharCode) -> String {
    String(bytes: [UInt8((code >> 24) & 255), UInt8((code >> 16) & 255),
                   UInt8((code >> 8) & 255), UInt8(code & 255)], encoding: .ascii) ?? String(code)
}

func saveJPEG(_ image: CGImage, to url: URL) throws {
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
    else { throw RenderError.message("Cannot create QA JPEG: \(url.path)") }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.94] as CFDictionary)
    try require(CGImageDestinationFinalize(destination), "QA JPEG write failed")
}

@main
struct RenderHomeShopping {
    @MainActor
    static func main() async {
        do { try await render() }
        catch {
            FileHandle.standardError.write(Data("Home-shopping render failed: \(error)\n".utf8))
            exit(1)
        }
    }

    @MainActor
    static func render() async throws {
        let args = CommandLine.arguments
        try require(args.count == 4 || (args.count == 5 && args[4] == "--preview"),
                    "Usage: render_home_shopping <rootDir> <planJson> <outputMp4> [--preview]")
        let isPreview = args.count == 5
        let root = URL(fileURLWithPath: args[1], isDirectory: true).standardizedFileURL
        let planURL = URL(fileURLWithPath: args[2]).standardizedFileURL
        let destination = URL(fileURLWithPath: args[3]).standardizedFileURL
        let fm = FileManager.default
        let plan = try JSONDecoder().decode(RenderPlan.self, from: Data(contentsOf: planURL))
        try require(plan.width == 1920 && plan.height == 1080 && plan.fps == 25,
                    "Broadcast layout requires 1920×1080 at 25 fps")
        let requiredDuration: Double = isPreview ? 10 : 120
        let requiredScenes = isPreview ? 1 : 12
        try require(abs(plan.duration_s - requiredDuration) < 0.001 && plan.scenes.count == requiredScenes,
                    isPreview
                        ? "--preview requires exactly 10 seconds and one 10-second scene; it is not the complete broadcast"
                        : "Full broadcast requires exactly 120 seconds and 12 scenes; use --preview explicitly for a 10-second preview")
        try require(plan.persistent_label.contains("AI") && plan.persistent_label.contains("가상") && plan.persistent_label.contains("데모"),
                    "Persistent label must disclose AI 가상 쇼호스트 and 데모 방송")
        try require(!fm.fileExists(atPath: destination.path), "Output already exists; choose a new path")
        try require(!plan.scenes.isEmpty, "The plan needs scenes")
        var expectedStart = 0.0
        var ids = Set<String>()
        for scene in plan.scenes {
            try require(ids.insert(scene.id).inserted, "Duplicate scene ID: \(scene.id)")
            try require(scene.start_s.isFinite && scene.duration_s.isFinite && abs(scene.duration_s - 10) < 0.001 && abs(scene.start_s - expectedStart) < 0.001,
                        "Scenes must be continuous 10-second slots from time zero; invalid scene \(scene.id)")
            try require(["host_product", "product_focus", "styling"].contains(scene.layout), "Invalid scene layout: \(scene.layout)")
            try require((1...4).contains(scene.images.count), "Scene \(scene.id) needs 1–4 actual image files")
            if scene.layout == "styling" {
                try require(scene.images.count == 3 && scene.images[0].contains("lookbooks/") && !scene.images[1].contains("lookbooks/") && !scene.images[2].contains("lookbooks/"),
                            "Styling must use one AI Lookbook followed by two actual product images")
            }
            try require(scene.audio_start_s.isFinite && scene.audio_end_s.isFinite && scene.audio_start_s >= scene.start_s &&
                        scene.audio_end_s <= scene.start_s + scene.duration_s + 0.001 && scene.audio_start_s < scene.audio_end_s,
                        "Narration timing is outside scene \(scene.id)")
            expectedStart += scene.duration_s
        }
        try require(abs(expectedStart - plan.duration_s) < 0.001, "Scenes do not cover exactly \(plan.duration_s) seconds")

        // Validate the complete moving-host source before producing any output.
        let host = try await HostFrameStream(url: resolvePath(plan.host_video_path, root: root), duration: plan.duration_s, fps: plan.fps)
        let audioAsset = AVURLAsset(url: resolvePath(plan.audio_path, root: root))
        let audioTracks = try await audioAsset.loadTracks(withMediaType: .audio)
        let audioDuration = CMTimeGetSeconds(try await audioAsset.load(.duration))
        try require(!audioTracks.isEmpty && abs(audioDuration - plan.duration_s) <= 0.01,
                    "Narration must contain an audio track arranged on the complete \(plan.duration_s)-second render timeline")
        try fm.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        let stem = destination.deletingPathExtension().lastPathComponent
        let qaDir = destination.deletingLastPathComponent().appendingPathComponent(stem + "-qa", isDirectory: true)
        try fm.createDirectory(at: qaDir, withIntermediateDirectories: true)
        let intermediate = destination.deletingLastPathComponent().appendingPathComponent(".\(stem)-silent-\(UUID().uuidString).mp4")
        let design = HomeShoppingDesign(root: root, plan: plan)
        let writer = try AVAssetWriter(outputURL: intermediate, fileType: .mp4)
        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: plan.width, AVVideoHeightKey: plan.height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 8_000_000, AVVideoExpectedSourceFrameRateKey: plan.fps,
                AVVideoMaxKeyFrameIntervalKey: plan.fps * 2, AVVideoAllowFrameReorderingKey: false,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
            ]
        ]
        try require(writer.canApply(outputSettings: videoSettings, forMediaType: .video),
                    "H.264 encoding requires access to macOS media services")
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        input.expectsMediaDataInRealTime = false
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: plan.width, kCVPixelBufferHeightKey as String: plan.height,
            kCVPixelBufferCGImageCompatibilityKey as String: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
        ])
        try require(writer.canAdd(input), "Writer rejected the video input")
        writer.add(input)
        try require(writer.startWriting(), "Writer start failed: \(String(describing: writer.error))")
        defer { if writer.status == .writing { writer.cancelWriting() } }
        writer.startSession(atSourceTime: .zero)
        guard let pool = adaptor.pixelBufferPool else { throw RenderError.message("No output pixel-buffer pool") }
        let frameCount = Int((plan.duration_s * Double(plan.fps)).rounded())
        let totalTime = CMTime(value: Int64(frameCount), timescale: Int32(plan.fps))
        var sceneIndex = 0
        var layers = try design.makeScene(plan.scenes[0])
        print(isPreview ? "MODE: 10-second preview only; full 120-second broadcast is not complete" : "MODE: full 120-second broadcast")
        print("Host source: \(Int(host.sourceSize.width))×\(Int(host.sourceSize.height)), \(host.sourceFPS) fps, \(host.sourceDuration)s")
        for frame in 0..<frameCount {
            let time = Double(frame) / Double(plan.fps)
            while sceneIndex + 1 < plan.scenes.count && time + 0.0001 >= plan.scenes[sceneIndex + 1].start_s {
                sceneIndex += 1
                layers = try autoreleasepool { try design.makeScene(plan.scenes[sceneIndex]) }
                print("Scene \(sceneIndex + 1)/\(plan.scenes.count): \(plan.scenes[sceneIndex].id)")
            }
            let waitStart = Date()
            while !input.isReadyForMoreMediaData {
                try require(writer.status == .writing, "Encoder stopped: \(String(describing: writer.error))")
                try require(Date().timeIntervalSince(waitStart) < 30, "Encoder stalled for 30 seconds")
                try await Task.sleep(nanoseconds: 2_000_000)
            }
            try autoreleasepool {
                var maybeBuffer: CVPixelBuffer?
                let result = CVPixelBufferPoolCreatePixelBuffer(nil, pool, &maybeBuffer)
                guard result == kCVReturnSuccess, let buffer = maybeBuffer else {
                    throw RenderError.message("Output frame allocation failed: \(result)")
                }
                try require(CVPixelBufferLockBaseAddress(buffer, []) == kCVReturnSuccess, "Cannot lock output frame")
                defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
                let bitmapInfo = CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue
                guard let context = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: plan.width, height: plan.height,
                                              bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
                                              space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: bitmapInfo)
                else { throw RenderError.message("Cannot draw into output pixel buffer") }
                let canvas = try Canvas(width: plan.width, height: plan.height, context: context)
                context.draw(layers.background, in: CGRect(x: 0, y: 0, width: plan.width, height: plan.height))
                try host.draw(at: time, canvas: canvas, placement: layers.host)
                let scene = plan.scenes[sceneIndex]
                if time >= scene.audio_start_s && time < scene.audio_end_s {
                    context.draw(layers.facts, in: canvas.rect(56, 798, 1808, 33))
                    context.draw(layers.subtitle, in: canvas.rect(44, 832, 1832, 108))
                }
                try require(adaptor.append(buffer, withPresentationTime: CMTime(value: Int64(frame), timescale: Int32(plan.fps))),
                            "Output frame \(frame) rejected: \(String(describing: writer.error))")
            }
            if frame % (plan.fps * 5) == 0 { print("Encoded \(frame / plan.fps)/\(Int(plan.duration_s)) seconds with moving host") }
        }
        try host.finish(expectedFrames: frameCount)
        input.markAsFinished()
        writer.endSession(atSourceTime: totalTime)
        await writer.finishWriting()
        try require(writer.status == .completed, "Silent broadcast export failed: \(String(describing: writer.error))")

        let silentAsset = AVURLAsset(url: intermediate)
        guard let silentTrack = try await silentAsset.loadTracks(withMediaType: .video).first else {
            throw RenderError.message("Silent broadcast contains no video track")
        }
        let composition = AVMutableComposition()
        guard let videoDestination = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
              let audioDestination = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
        else { throw RenderError.message("Cannot create final composition tracks") }
        let range = CMTimeRange(start: .zero, duration: totalTime)
        try videoDestination.insertTimeRange(range, of: silentTrack, at: .zero)
        try audioDestination.insertTimeRange(range, of: audioTracks[0], at: .zero)
        guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPreset1920x1080) else {
            throw RenderError.message("Cannot create H.264/AAC export session")
        }
        export.timeRange = range
        export.shouldOptimizeForNetworkUse = true
        print("Muxing the complete Korean narration with the moving-host broadcast…")
        try await export.export(to: destination, as: .mp4)
        let finalAsset = AVURLAsset(url: destination)
        let duration = try await finalAsset.load(.duration)
        let finalVideo = try await finalAsset.loadTracks(withMediaType: .video)
        let finalAudio = try await finalAsset.loadTracks(withMediaType: .audio)
        try require(finalVideo.count == 1 && finalAudio.count == 1, "Output requires one video and one audio track")
        let size = try await finalVideo[0].load(.naturalSize)
        let fps = try await finalVideo[0].load(.nominalFrameRate)
        let videoDescriptions = try await finalVideo[0].load(.formatDescriptions)
        let audioDescriptions = try await finalAudio[0].load(.formatDescriptions)
        try require(!videoDescriptions.isEmpty && !audioDescriptions.isEmpty, "Output track format descriptions missing")
        let videoCodec = CMFormatDescriptionGetMediaSubType(videoDescriptions[0])
        let audioCodec = CMFormatDescriptionGetMediaSubType(audioDescriptions[0])
        let finalDuration = CMTimeGetSeconds(duration)
        try require(abs(finalDuration - plan.duration_s) < 0.001, "Output duration mismatch: \(finalDuration)")
        try require(Int(size.width) == plan.width && Int(size.height) == plan.height, "Output dimensions mismatch")
        try require(abs(Double(fps) - Double(plan.fps)) < 0.01, "Output frame rate mismatch: \(fps)")
        try require(videoCodec == kCMVideoCodecType_H264, "Output video is \(fourCC(videoCodec)); expected H.264")
        try require(audioCodec == kAudioFormatMPEG4AAC, "Output audio is \(fourCC(audioCodec)); expected AAC")

        let generator = AVAssetImageGenerator(asset: finalAsset)
        generator.appliesPreferredTrackTransform = true
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = .zero
        var qaTimes: [(String, Double)] = [("00-first", 0), ("00-host-motion-1", 1), ("00-host-motion-2", 2)]
        for (index, scene) in plan.scenes.enumerated() {
            qaTimes.append((String(format: "%02d", index + 1) + "-" + scene.id, (scene.audio_start_s + scene.audio_end_s) / 2))
        }
        qaTimes.append(("99-last", Double(frameCount - 1) / Double(plan.fps)))
        var qaFrames: [[String: Any]] = []
        for (name, time) in qaTimes {
            let frame = min(frameCount - 1, max(0, Int((time * Double(plan.fps)).rounded())))
            let requested = CMTime(value: Int64(frame), timescale: Int32(plan.fps))
            let extracted = try await generator.image(at: requested)
            let safeName = name.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" ? String($0) : "_" }.joined()
            let imageURL = qaDir.appendingPathComponent(safeName + ".jpg")
            try saveJPEG(extracted.image, to: imageURL)
            qaFrames.append(["file": imageURL.path, "requested_time_s": CMTimeGetSeconds(requested),
                             "actual_time_s": CMTimeGetSeconds(extracted.actualTime)])
        }
        let bytes = (try fm.attributesOfItem(atPath: destination.path)[.size] as? NSNumber)?.int64Value ?? 0
        let metadata: [String: Any] = [
            "validation_status": "PASS", "output_path": destination.path,
            "render_mode": isPreview ? "preview" : "full",
            "is_preview": isPreview,
            "delivery_status": isPreview ? "PREVIEW_ONLY_NOT_FULL_BROADCAST" : "ENCODED_AWAITING_VISUAL_REVIEW",
            "validation_scope": "Technical encoding and host-frame sampling for this \(Int(plan.duration_s))-second output; lip-sync and human visual review remain separate.",
            "full_broadcast_target_duration_s": 120,
            "full_broadcast_encoded": !isPreview,
            "output_timeline_start_s": 0,
            "output_timeline_end_s": plan.duration_s,
            "duration_s": finalDuration, "duration_value": duration.value, "duration_timescale": duration.timescale,
            "width": Int(size.width), "height": Int(size.height), "fps": fps,
            "frame_count_submitted": frameCount, "video_codec": "h264", "audio_codec": "aac",
            "video_codec_fourcc": fourCC(videoCodec), "audio_codec_fourcc": fourCC(audioCodec),
            "video_track_count": finalVideo.count, "audio_track_count": finalAudio.count, "file_size_bytes": bytes,
            "has_host": true, "media_type": "animated_virtual_home_shopping_host",
            "host_source_path": host.sourceURL.path, "host_source_duration_s": host.sourceDuration,
            "host_source_fps": host.sourceFPS, "host_source_width": host.sourceSize.width, "host_source_height": host.sourceSize.height,
            "host_decoded_frames": host.decodedFrames, "host_frames_drawn": host.sampledFrames,
            "host_changed_frame_signatures": host.changedSampledFrames,
            "host_signature_check_scope": "Rejects an entirely static MP4; this is not a lip-sync or human visual-quality assessment.",
            "host_maximum_sampling_skew_s": host.largestSampleSkew, "host_sampling_examples": host.sampledTimestamps,
            "host_sampling_policy": "Sequential AVAssetReader sampling from source time 0 over the \(Int(plan.duration_s))-second output timeline; no loop, time warp or still fallback; at most two decoded samples retained.",
            "persistent_label": plan.persistent_label,
            "subtitle_timing": "Narration and short caption facts appear only while scene.audio_start_s <= video time < scene.audio_end_s.",
            "qa_frames": qaFrames, "video_ai_validation": "NOT_PERFORMED",
            "generated_at": ISO8601DateFormatter().string(from: Date())
        ]
        let metadataURL = destination.deletingLastPathComponent().appendingPathComponent(stem + ".metadata.json")
        try JSONSerialization.data(withJSONObject: metadata, options: [.prettyPrinted, .sortedKeys]).write(to: metadataURL)
        try fm.removeItem(at: intermediate) // Only this render's uniquely named scratch movie.
        print("\(isPreview ? "PREVIEW_COMPLETE" : "COMPLETE") \(destination.path)")
        print("METADATA \(metadataURL.path)")
        print("QA_FRAMES \(qaDir.path)")
    }
}
