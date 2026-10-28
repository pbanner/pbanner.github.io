// Camera moves for the axis gizmo (AxisGizmo.jsx): clicking an axis label
// swings the camera around to look along that axis. Plain math, no React.
//
// The camera is described the way OrbitControls describes it, in spherical
// coordinates around its target, with z up: a distance r, a polar angle
// (0 = straight above the target, pi/2 = level with it, pi = straight
// below) and an azimuth (the compass direction of the camera from the
// target, measured from +x toward +y). Moving the polar angle and azimuth
// is exactly an orbit, with the camera's up staying +z throughout, so the
// view never rolls -- the same motion as dragging the view by hand.

// Straight above or below the target, the azimuth no longer changes where
// the camera is, only how the picture is turned. OrbitControls works out
// the azimuth from the camera's position, so exactly at the pole it would
// lose it. Stopping this far (in radians) short of the pole keeps it,
// while still looking straight down (or up) to the eye.
const POLE_OFFSET = 1e-3;

export function sphericalAround([x, y, z], [tx, ty, tz]) {
  const dx = x - tx;
  const dy = y - ty;
  const dz = z - tz;
  const r = Math.hypot(dx, dy, dz);
  return { r, polar: Math.acos(Math.max(-1, Math.min(1, dz / r))), azimuth: Math.atan2(dy, dx) };
}

export function positionAround({ r, polar, azimuth }, [tx, ty, tz]) {
  return [
    tx + r * Math.sin(polar) * Math.cos(azimuth),
    ty + r * Math.sin(polar) * Math.sin(azimuth),
    tz + r * Math.cos(polar),
  ];
}

// The change in angle from a to b the short way around, in (-pi, pi].
export function shortestTurn(a, b) {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

// Where to put the camera to look along an axis: `axis` is the unit vector
// of the clicked axis label (e.g. [1, 0, 0] for +x), and the camera goes to
// that side of the target, looking back at it.
//
// For the x and y axes that pins down both angles. For +z and -z it pins
// down only the polar angle, and the azimuth is the current one rounded to
// the nearest multiple of 90 degrees: tipping straight over the top (or
// under the bottom) keeps the picture's up direction continuous, and the
// rounding then turns it at most 45 degrees so that +/-x and +/-y line up
// with the screen's edges. From the default view, that's the familiar xy
// plane: x to the right, y up.
export function axisView(axis, current) {
  const [ax, ay, az] = axis;
  if (Math.abs(az) > 0.5) {
    const quarter = Math.PI / 2;
    return {
      polar: az > 0 ? POLE_OFFSET : Math.PI - POLE_OFFSET,
      azimuth: Math.round(current.azimuth / quarter) * quarter,
    };
  }
  return { polar: Math.PI / 2, azimuth: Math.atan2(ay, ax) };
}
