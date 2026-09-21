"""Narrow in-memory compatibility patches for legacy SadTalker MPS dtype strings.

No global Tensor monkeypatch and no changes to the official repository files.
"""
def apply_mps_compat():
    import torch
    from src.facerender.modules import util, dense_motion, keypoint_detector

    if getattr(util.make_coordinate_grid, "_sadtalker_mps_compat", False):
        return
    original_grid = util.make_coordinate_grid

    def grid(spatial_size, type):
        if type == "torch.mps.FloatTensor":
            return original_grid(spatial_size, "torch.FloatTensor").to("mps")
        if type == "torch.mps.HalfTensor":
            return original_grid(spatial_size, "torch.FloatTensor").to(device="mps", dtype=torch.float16)
        return original_grid(spatial_size, type)
    grid._sadtalker_mps_compat = True
    util.make_coordinate_grid = grid
    dense_motion.make_coordinate_grid = grid
    keypoint_detector.make_coordinate_grid = grid

    def create_heatmap_representations(self, feature, kp_driving, kp_source):
        spatial_size = feature.shape[3:]
        gaussian_driving = dense_motion.kp2gaussian(kp_driving, spatial_size=spatial_size, kp_variance=0.01)
        gaussian_source = dense_motion.kp2gaussian(kp_source, spatial_size=spatial_size, kp_variance=0.01)
        heatmap = gaussian_driving - gaussian_source
        zeros = heatmap.new_zeros(heatmap.shape[0], 1, spatial_size[0], spatial_size[1], spatial_size[2])
        return torch.cat([zeros, heatmap], dim=1).unsqueeze(2)
    dense_motion.DenseMotionNetwork.create_heatmap_representations = create_heatmap_representations
