// Build: xcrun swiftc -parse-as-library -O -module-cache-path /tmp/gs-ai-swift-module-cache scripts/render_test_video.swift -o /tmp/render_test_video
// Run outside the sandbox so macOS media encoder services are available.
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
}

struct RenderPlan: Decodable {
    let width: Int
    let height: Int
    let fps: Int
    let duration_s: Double
    let audio_path: String
    let persistent_label: String?
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
    static let background = color(0xF2F3EF)
    static let ink = color(0x192B2A)
    static let muted = color(0x647470)
    static let accent = color(0x197E69)
    static let pale = color(0xE9F3EF)
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

struct CachedScene {
    let base: CGImage
    let narration: CGImage
}

@MainActor
final class BroadcastDesign {
    let root: URL
    let plan: RenderPlan
    private var imageCache: [String: CGImage] = [:]

    init(root: URL, plan: RenderPlan) { self.root = root; self.plan = plan }

    func sourceImage(_ path: String) throws -> CGImage {
        if let cached = imageCache[path] { return cached }
        let url = root.appendingPathComponent(path)
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
        else { throw RenderError.message("Cannot read image: \(path)") }
        imageCache[path] = image
        return image
    }

    func imageLabel(_ scene: Scene, _ index: Int) -> String {
        if let labels = scene.image_labels, labels.indices.contains(index) { return labels[index] }
        return scene.images[index].contains("lookbooks/") ? "AI 코디 예시" : "실제 상품 이미지"
    }

    func tile(_ canvas: Canvas, scene: Scene, index: Int,
              x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat,
              ai: Bool = false) throws {
        canvas.box(x, y, width, height, radius: 18, fill: Palette.white, stroke: Palette.border)
        try canvas.contain(sourceImage(scene.images[index]), x: x + 13, y: y + 13,
                           width: width - 26, height: height - 70)
        canvas.box(x + 12, y + height - 48, width - 24, 36, radius: 9,
                   fill: ai ? Palette.accent : Palette.pale)
        canvas.text(imageLabel(scene, index), x: x + 21, y: y + height - 43,
                    width: width - 42, height: 28, size: 20, minSize: 16,
                    bold: true, fill: ai ? .white : Palette.ink, alignment: .center)
    }

    func makeScene(_ scene: Scene, index: Int) throws -> CachedScene {
        let canvas = try Canvas(width: 1920, height: 1080)
        canvas.fill(Palette.background)
        canvas.box(0, 0, 1920, 108, fill: Palette.white)
        canvas.box(64, 38, 9, 34, radius: 4, fill: Palette.accent)
        canvas.text("GS AI LIVE", x: 89, y: 34, width: 245, height: 48, size: 34, bold: true)
        canvas.text("상품 정보로 살펴보는 라이브", x: 337, y: 43, width: 580, height: 35,
                    size: 23, fill: Palette.muted)
        canvas.box(1207, 32, 528, 43, radius: 21, fill: Palette.pale)
        canvas.text(plan.persistent_label ?? "기능 검증용 샘플 · 실제 방송 아님",
                    x: 1226, y: 40, width: 490, height: 29, size: 21, minSize: 18,
                    bold: true, fill: Palette.accent, alignment: .center)
        canvas.text(String(format: "%02d / %02d", index + 1, plan.scenes.count),
                    x: 1752, y: 40, width: 108, height: 32, size: 23,
                    bold: true, fill: Palette.muted, alignment: .right, monospaced: true)

        // The source images are always contained at their original aspect ratio.
        // Long detail images deliberately remain whole, supplemented by text cards.
        canvas.box(64, 132, 1114, 700, radius: 26, fill: color(0xE7ECE7))
        switch scene.images.count {
        case 4:
            for i in 0..<4 {
                try tile(canvas, scene: scene, index: i,
                         x: 83 + CGFloat(i % 2) * 537,
                         y: 150 + CGFloat(i / 2) * 333,
                         width: 518, height: 315)
            }
        case 3:
            let isLook = scene.images[0].contains("lookbooks/")
            try tile(canvas, scene: scene, index: 0, x: 83, y: 150,
                     width: 738, height: 663, ai: isLook)
            try tile(canvas, scene: scene, index: 1, x: 840, y: 150,
                     width: 319, height: 322)
            try tile(canvas, scene: scene, index: 2, x: 840, y: 490,
                     width: 319, height: 323)
        case 2:
            try tile(canvas, scene: scene, index: 0, x: 83, y: 150,
                     width: 743, height: 663)
            try tile(canvas, scene: scene, index: 1, x: 845, y: 281,
                     width: 314, height: 401)
        case 1:
            try tile(canvas, scene: scene, index: 0, x: 83, y: 150,
                     width: 1076, height: 663)
        default:
            throw RenderError.message("Each scene needs 1–4 source images")
        }

        canvas.box(1204, 132, 652, 700, radius: 26, fill: Palette.white)
        canvas.text(scene.kicker, x: 1246, y: 170, width: 568, height: 54,
                    size: 22, minSize: 19, bold: true, fill: Palette.accent)
        canvas.text(scene.title, x: 1246, y: 233, width: 568, height: 116,
                    size: 43, minSize: 37, bold: true)
        canvas.box(1246, 352, 70, 5, radius: 2, fill: Palette.accent)

        let lines = scene.caption_lines
        for (i, caption) in lines.enumerated() {
            let y: CGFloat = 383 + CGFloat(i) * 105
            let isWarning = caption.contains("품절")
            canvas.box(1246, y, 568, 90, radius: 16,
                       fill: isWarning ? color(0xFBF0E7) : Palette.pale)
            canvas.text(caption, x: 1268, y: y + 18, width: 524, height: 60,
                        size: i == 0 ? 30 : 27, minSize: 23,
                        bold: i == 0 || isWarning,
                        fill: isWarning ? Palette.warning : Palette.ink)
        }
        canvas.box(1246, 730, 568, 1, fill: Palette.border)
        canvas.text(scene.label, x: 1246, y: 750, width: 568, height: 61,
                    size: 21, minSize: 18, fill: Palette.muted)

        canvas.box(64, 855, 1792, 153, radius: 20, fill: Palette.white, stroke: Palette.border)
        canvas.text("한국어 내레이션", x: 93, y: 875, width: 245, height: 27,
                    size: 19, bold: true, fill: Palette.accent)
        canvas.text("상품 이미지 · 합성 음성", x: 93, y: 923, width: 1600, height: 39,
                    size: 25, fill: color(0x9AA8A2))
        canvas.text("GS AI LIVE  /  상품 정보 테스트 영상", x: 64, y: 1028,
                    width: 730, height: 27, size: 18, fill: Palette.muted)
        canvas.box(700, 1040, 960, 6, radius: 3, fill: color(0xD6DFD9))

        let narration = try Canvas(width: 1792, height: 153)
        narration.fill(.white)
        narration.text("한국어 내레이션", x: 29, y: 20, width: 300, height: 27,
                       size: 19, bold: true, fill: Palette.accent)
        narration.text(scene.narration, x: 29, y: 61, width: 1734, height: 81,
                       size: 31, minSize: 28)
        return try CachedScene(base: canvas.image(), narration: narration.image())
    }
}

func fourCC(_ code: FourCharCode) -> String {
    String(bytes: [UInt8((code >> 24) & 255), UInt8((code >> 16) & 255),
                   UInt8((code >> 8) & 255), UInt8(code & 255)], encoding: .ascii) ?? String(code)
}

func saveJPEG(_ image: CGImage, to url: URL) throws {
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
    else { throw RenderError.message("Cannot create QA JPEG at \(url.path)") }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.94] as CFDictionary)
    try require(CGImageDestinationFinalize(destination), "QA JPEG write failed")
}

@main
struct RenderTestVideo {
    @MainActor
    static func main() async {
        do {
            try await render()
        } catch {
            FileHandle.standardError.write(Data("Render failed: \(error)\n".utf8))
            exit(1)
        }
    }

    @MainActor
    static func render() async throws {
        let args = CommandLine.arguments
        try require(args.count == 4, "Usage: render_test_video <rootDir> <planJson> <outputMp4>")
        let root = URL(fileURLWithPath: args[1], isDirectory: true).standardizedFileURL
        let planURL = URL(fileURLWithPath: args[2]).standardizedFileURL
        let output = URL(fileURLWithPath: args[3]).standardizedFileURL
        let fm = FileManager.default
        let plan = try JSONDecoder().decode(RenderPlan.self, from: Data(contentsOf: planURL))
        try require(plan.width == 1920 && plan.height == 1080, "This layout requires 1920×1080")
        try require(plan.fps > 0 && plan.fps <= 60, "Invalid FPS")
        try require(plan.duration_s == 120 && plan.scenes.count == 12, "Expected a 120-second, 12-scene plan")
        try require(!fm.fileExists(atPath: output.path), "Output already exists; choose a new output path")
        for (i, scene) in plan.scenes.enumerated() {
            try require(scene.start_s == Double(i * 10) && scene.duration_s == 10,
                        "Scene \(scene.id) must have a fixed 10-second slot")
            try require((2...3).contains(scene.caption_lines.count), "Expected 2–3 caption lines")
            try require(scene.audio_start_s >= scene.start_s && scene.audio_end_s <= scene.start_s + 10 && scene.audio_start_s < scene.audio_end_s,
                        "Audio timing exceeds scene \(scene.id)")
        }

        let audioURL = root.appendingPathComponent(plan.audio_path)
        let audioAsset = AVURLAsset(url: audioURL)
        let audioTracks = try await audioAsset.loadTracks(withMediaType: .audio)
        let audioDuration = try await audioAsset.load(.duration)
        try require(!audioTracks.isEmpty, "Narration file contains no audio track")
        try require(abs(CMTimeGetSeconds(audioDuration) - plan.duration_s) <= 0.01,
                    "Narration must already be arranged on the 120-second timeline")
        try fm.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
        let stem = output.deletingPathExtension().lastPathComponent
        let qaDir = output.deletingLastPathComponent().appendingPathComponent(stem + "-qa", isDirectory: true)
        try fm.createDirectory(at: qaDir, withIntermediateDirectories: true)
        let intermediate = output.deletingLastPathComponent().appendingPathComponent(".\(stem)-silent-\(UUID().uuidString).mp4")

        let design = BroadcastDesign(root: root, plan: plan)
        var cache: [CachedScene] = []
        for (index, scene) in plan.scenes.enumerated() {
            cache.append(try autoreleasepool { try design.makeScene(scene, index: index) })
            print("Prepared scene \(index + 1)/\(plan.scenes.count): \(scene.id)")
        }

        let writer = try AVAssetWriter(outputURL: intermediate, fileType: .mp4)
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: plan.width, AVVideoHeightKey: plan.height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 6_000_000,
                AVVideoExpectedSourceFrameRateKey: plan.fps,
                AVVideoMaxKeyFrameIntervalKey: plan.fps * 2,
                AVVideoAllowFrameReorderingKey: false,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
            ]
        ]
        try require(writer.canApply(outputSettings: settings, forMediaType: .video),
                    "H.264 unavailable; execute with access to macOS encoder services")
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = false
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: plan.width,
            kCVPixelBufferHeightKey as String: plan.height,
            kCVPixelBufferCGImageCompatibilityKey as String: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
        ])
        try require(writer.canAdd(input), "Writer rejected video input")
        writer.add(input)
        try require(writer.startWriting(), "Writer start failed: \(String(describing: writer.error))")
        writer.startSession(atSourceTime: .zero)
        guard let pool = adaptor.pixelBufferPool else { throw RenderError.message("No pixel buffer pool") }
        let frameCount = Int(plan.duration_s * Double(plan.fps))
        let totalTime = CMTime(value: Int64(frameCount), timescale: Int32(plan.fps))
        var timecodeCache: [Int: CGImage] = [:]
        for second in 0...Int(plan.duration_s) {
            let timecode = try Canvas(width: 184, height: 32)
            timecode.text(String(format: "%02d:%02d / 02:00", second / 60, second % 60),
                          x: 0, y: 1, width: 184, height: 30,
                          size: 20, bold: true, fill: Palette.muted,
                          alignment: .right, monospaced: true)
            timecodeCache[second] = try timecode.image()
        }

        for frame in 0..<frameCount {
            let waitStart = Date()
            while !input.isReadyForMoreMediaData {
                try require(writer.status == .writing,
                            "Writer stopped: \(String(describing: writer.error))")
                try require(Date().timeIntervalSince(waitStart) < 60, "Encoder stalled for 60 seconds")
                try await Task.sleep(nanoseconds: 2_000_000)
            }
            try autoreleasepool {
                var maybeBuffer: CVPixelBuffer?
                let result = CVPixelBufferPoolCreatePixelBuffer(nil, pool, &maybeBuffer)
                guard result == kCVReturnSuccess, let buffer = maybeBuffer else {
                    throw RenderError.message("Pixel buffer allocation failed: \(result)")
                }
                CVPixelBufferLockBaseAddress(buffer, [])
                let bitmapInfo = CGBitmapInfo.byteOrder32Little.rawValue |
                    CGImageAlphaInfo.premultipliedFirst.rawValue
                guard let context = CGContext(
                    data: CVPixelBufferGetBaseAddress(buffer), width: plan.width, height: plan.height,
                    bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: bitmapInfo
                ) else {
                    CVPixelBufferUnlockBaseAddress(buffer, [])
                    throw RenderError.message("Cannot create pixel context")
                }
                let canvas = try Canvas(width: plan.width, height: plan.height, context: context)
                let time = Double(frame) / Double(plan.fps)
                let sceneIndex = min(Int(time / 10), plan.scenes.count - 1)
                let scene = plan.scenes[sceneIndex]
                context.draw(cache[sceneIndex].base, in: CGRect(x: 0, y: 0, width: plan.width, height: plan.height))
                if time >= scene.audio_start_s && time < scene.audio_end_s {
                    context.saveGState()
                    context.addPath(CGPath(roundedRect: canvas.rect(64, 855, 1792, 153),
                                           cornerWidth: 20, cornerHeight: 20, transform: nil))
                    context.clip()
                    context.draw(cache[sceneIndex].narration, in: canvas.rect(64, 855, 1792, 153))
                    context.restoreGState()
                }
                let progress = CGFloat(frame + 1) / CGFloat(frameCount)
                canvas.box(700, 1040, 960 * progress, 6, radius: 3, fill: Palette.accent)
                if let code = timecodeCache[Int(time)] {
                    context.draw(code, in: canvas.rect(1672, 1027, 184, 32))
                }
                CVPixelBufferUnlockBaseAddress(buffer, [])
                try require(adaptor.append(buffer, withPresentationTime: CMTime(value: Int64(frame), timescale: Int32(plan.fps))),
                            "Frame \(frame) rejected: \(String(describing: writer.error))")
            }
            if frame % (plan.fps * 10) == 0 { print("Encoded \(frame / plan.fps)/120 seconds") }
        }
        input.markAsFinished()
        writer.endSession(atSourceTime: totalTime)
        await writer.finishWriting()
        try require(writer.status == .completed, "Silent video failed: \(String(describing: writer.error))")

        let silentAsset = AVURLAsset(url: intermediate)
        guard let videoTrack = try await silentAsset.loadTracks(withMediaType: .video).first else {
            throw RenderError.message("Encoded video has no video track")
        }
        let composition = AVMutableComposition()
        guard let videoDestination = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
              let audioDestination = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
        else { throw RenderError.message("Cannot create composition tracks") }
        let range = CMTimeRange(start: .zero, duration: totalTime)
        try videoDestination.insertTimeRange(range, of: videoTrack, at: .zero)
        try audioDestination.insertTimeRange(range, of: audioTracks[0], at: .zero)
        guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPreset1920x1080) else {
            throw RenderError.message("Cannot create H.264/AAC export session")
        }
        export.timeRange = range
        export.shouldOptimizeForNetworkUse = true
        print("Muxing and exporting H.264/AAC MP4…")
        try await export.export(to: output, as: .mp4)

        let finalAsset = AVURLAsset(url: output)
        let duration = try await finalAsset.load(.duration)
        let finalVideoTracks = try await finalAsset.loadTracks(withMediaType: .video)
        let finalAudioTracks = try await finalAsset.loadTracks(withMediaType: .audio)
        try require(finalVideoTracks.count == 1 && finalAudioTracks.count == 1, "Output must have one video and one audio track")
        let dimensions = try await finalVideoTracks[0].load(.naturalSize)
        let fps = try await finalVideoTracks[0].load(.nominalFrameRate)
        let videoDescriptions = try await finalVideoTracks[0].load(.formatDescriptions)
        let audioDescriptions = try await finalAudioTracks[0].load(.formatDescriptions)
        let videoCode = CMFormatDescriptionGetMediaSubType(videoDescriptions[0])
        let audioCode = CMFormatDescriptionGetMediaSubType(audioDescriptions[0])
        let durationSeconds = CMTimeGetSeconds(duration)
        try require(abs(durationSeconds - 120) < 0.001, "Output duration is not exactly 120 seconds: \(durationSeconds)")
        try require(Int(dimensions.width) == plan.width && Int(dimensions.height) == plan.height, "Output resolution mismatch")
        try require(abs(Double(fps) - Double(plan.fps)) < 0.01, "Output FPS mismatch: \(fps)")
        try require(videoCode == kCMVideoCodecType_H264, "Output video codec is \(fourCC(videoCode)), expected H.264")
        try require(audioCode == kAudioFormatMPEG4AAC, "Output audio codec is \(fourCC(audioCode)), expected AAC")

        // QA stills are extracted from the finished MP4, not pre-encode bitmaps.
        let generator = AVAssetImageGenerator(asset: finalAsset)
        generator.appliesPreferredTrackTransform = true
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = .zero
        let qaSamples: [(String, Int64)] = [
            ("01-intro", 0), ("02-material", Int64(12 * plan.fps)),
            ("03-size", Int64(44 * plan.fps)), ("04-office", Int64(64 * plan.fps)),
            ("05-price", Int64(94 * plan.fps)), ("06-last", Int64(frameCount - 1))
        ]
        var qaMetadata: [[String: Any]] = []
        for (name, frame) in qaSamples {
            let time = CMTime(value: frame, timescale: Int32(plan.fps))
            let extracted = try await generator.image(at: time)
            let url = qaDir.appendingPathComponent(name + ".jpg")
            try saveJPEG(extracted.image, to: url)
            qaMetadata.append(["file": url.path, "requested_time_s": CMTimeGetSeconds(time),
                               "actual_time_s": CMTimeGetSeconds(extracted.actualTime)])
        }
        let fileSize = (try fm.attributesOfItem(atPath: output.path)[.size] as? NSNumber)?.int64Value ?? 0
        let metadata: [String: Any] = [
            "validation_status": "PASS", "output_path": output.path,
            "duration_s": durationSeconds, "duration_value": duration.value,
            "duration_timescale": duration.timescale,
            "width": Int(dimensions.width), "height": Int(dimensions.height),
            "fps": fps, "frame_count_submitted": frameCount,
            "video_codec": "h264", "video_codec_fourcc": fourCC(videoCode),
            "audio_codec": "aac", "audio_codec_fourcc": fourCC(audioCode),
            "video_track_count": finalVideoTracks.count, "audio_track_count": finalAudioTracks.count,
            "file_size_bytes": fileSize, "has_host": false,
            "media_type": "product_images_with_synthetic_narration",
            "subtitle_timing": "Visible only while scene.audio_start_s <= video time < scene.audio_end_s; quantized to the next output video frame",
            "qa_frames": qaMetadata,
            "video_ai_validation": "NOT_PERFORMED",
            "generated_at": ISO8601DateFormatter().string(from: Date())
        ]
        let metadataURL = output.deletingLastPathComponent().appendingPathComponent(stem + ".metadata.json")
        try JSONSerialization.data(withJSONObject: metadata, options: [.prettyPrinted, .sortedKeys]).write(to: metadataURL)
        try fm.removeItem(at: intermediate) // Only this run's uniquely named intermediate.
        print("COMPLETE \(output.path)")
        print("METADATA \(metadataURL.path)")
        print("QA_FRAMES \(qaDir.path)")
    }
}
