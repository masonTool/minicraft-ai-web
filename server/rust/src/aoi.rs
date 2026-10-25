//! 广播的"关注范围"（联机27）与快照裁剪（联机14）。
//!
//! 范围取"8 区块 + 同维度"：**看得见的范围**才需要实时更新，与 `welcome` 的裁剪半径
//! 是同一条口径。用切比雪夫距离（方形视野）而不是欧氏距离——与渲染的区块加载范围一致。

/// 这个玩家要不要收到"某一格/某一点"的广播。
pub fn within_aoi(
    player: (f64, f64, &str),
    x: f64,
    z: f64,
    dimension: &str,
    radius_chunks: i32,
) -> bool {
    if player.2 != dimension {
        return false;
    }
    if !(x.is_finite() && z.is_finite()) {
        return false;
    }
    chunk_distance(player.0, player.1, x, z) <= radius_chunks
}

/// 两个世界坐标之间的切比雪夫距离（按区块算）。
pub fn chunk_distance(ax: f64, az: f64, bx: f64, bz: f64) -> i32 {
    let dx = (ax.trunc() as i32 >> 4) - (bx.trunc() as i32 >> 4);
    let dz = (az.trunc() as i32 >> 4) - (bz.trunc() as i32 >> 4);
    dx.abs().max(dz.abs())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn far_players_are_out_of_range() {
        // 同维度、8 区块内
        assert!(within_aoi((0.0, 0.0, "overworld"), 100.0, 100.0, "overworld", 8));
        // 5000 格外（313 区块）
        assert!(!within_aoi((0.0, 0.0, "overworld"), 5000.0, 5000.0, "overworld", 8));
        // 同坐标不同维度
        assert!(!within_aoi((0.0, 0.0, "overworld"), 0.0, 0.0, "nether", 8));
    }

    #[test]
    fn chunk_distance_is_chebyshev() {
        assert_eq!(chunk_distance(0.0, 0.0, 15.0, 15.0), 0);
        assert_eq!(chunk_distance(0.0, 0.0, 16.0, 0.0), 1);
        // 负坐标按 JS 的 `>> 4`（向负无穷取整）：-17 → 区块 -2
        assert_eq!(chunk_distance(0.0, 0.0, -17.0, 0.0), 2);
        assert_eq!(chunk_distance(0.0, 0.0, 129.0, 0.0), 8);
    }
}
