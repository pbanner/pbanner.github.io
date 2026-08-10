import React, { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import { Line } from '@react-three/drei';
import * as THREE from 'three';

// The shaft's initial placeholder segment — never depends on props, so it
// only needs to exist once, not be rebuilt as a fresh array every render.
const PLACEHOLDER_POINTS = [[0, 0, 0], [0, 0, 0.001]];

const ThickArrowHelper = forwardRef(function ThickArrowHelper(
  { dir, origin, length, color, headLength = 0.2 * length, headWidth = 0.2 * headLength, shaftWidth = 2, visible = true },
  ref
) {
  const arrowRef = useRef();
  const lineRef = useRef();

  // Single source of truth for this arrow's geometry — every setter below
  // writes here, then re-derives BOTH the cone and the shaft from it.
  const state = useRef({
    dir: dir.clone().normalize(),
    origin: origin.clone(),
    length,
    headLength,
    headWidth,
  });

  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const initialArgs = useMemo(
    () => [dir, origin, length, color, headLength, headWidth],
    []
  );

  function sync() {
    const { dir, origin, length, headLength: rawHeadLength, headWidth: rawHeadWidth } = state.current;
    const arrow = arrowRef.current;
    const line = lineRef.current;
    if (!arrow || !line) return;

    const shouldShow = visibleRef.current && length >= 1e-4;
    arrow.visible = shouldShow;
    line.visible = shouldShow;
    if (!shouldShow) return;

    // Cap the head at a fraction of the arrow's own current length, so a
    // short arrow's head never grows longer than the shaft -- a fixed
    // absolute head size looks fine on a long arrow but visibly glitches a
    // short one (the cone overshoots the tip, and the shaft-end calculation
    // below can even go negative without this).
    const headLength = Math.min(rawHeadLength, length * 0.4);
    const headWidth = rawHeadLength > 0 ? rawHeadWidth * (headLength / rawHeadLength) : rawHeadWidth;

    arrow.position.copy(origin);
    arrow.setDirection(dir);
    arrow.setLength(length, headLength, headWidth);
    arrow.line.visible = false;

    const shaftEnd = origin.clone().addScaledVector(dir, Math.max(0, length - headLength));
    line.geometry.setPositions([origin.x, origin.y, origin.z, shaftEnd.x, shaftEnd.y, shaftEnd.z]);
  }

  useLayoutEffect(() => {
    sync();
  }, [visible]);

  useImperativeHandle(ref, () => ({
    setDirection(newDir) {
      state.current.dir = newDir.clone().normalize();
      sync();
    },
    setLength(newLength, newHeadLength = 0.2 * newLength, newHeadWidth = 0.2 * newHeadLength) {
      state.current.length = newLength;
      state.current.headLength = newHeadLength;
      state.current.headWidth = newHeadWidth;
      sync();
    },
  }), []);

  return (
    <>
      <arrowHelper ref={arrowRef} args={initialArgs} />
      <Line ref={lineRef} points={PLACEHOLDER_POINTS} color={color} lineWidth={shaftWidth} />
    </>
  );
});

export default ThickArrowHelper;