import React, { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { Line } from '@react-three/drei';
import * as THREE from 'three';

const ThickArrowHelper = forwardRef(function ThickArrowHelper(
  { dir, origin, length, color, headLength = 0.2 * length, headWidth = 0.2 * headLength, shaftWidth = 2 },
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

  function sync() {
    const { dir, origin, length, headLength, headWidth } = state.current;
    const arrow = arrowRef.current;
    const line = lineRef.current;
    if (!arrow || !line) return;

    if (length < 1e-4) {
      arrow.visible = false;
      line.visible = false;
      return;
    }
    arrow.visible = true;
    line.visible = true;

    arrow.position.copy(origin);
    arrow.setDirection(dir);
    arrow.setLength(length, headLength, headWidth);
    arrow.line.visible = false; // always suppress ArrowHelper's own 1px shaft

    const shaftEnd = origin.clone().addScaledVector(dir, Math.max(0, length - headLength));
    line.geometry.setPositions([origin.x, origin.y, origin.z, shaftEnd.x, shaftEnd.y, shaftEnd.z]);
  }

  useLayoutEffect(() => {
    sync();
  }, []);

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
      <arrowHelper ref={arrowRef} args={[dir, origin, length, color, headLength, headWidth]} />
      <Line ref={lineRef} points={[[0, 0, 0], [0, 0, 0.001]]} color={color} lineWidth={shaftWidth} />
    </>
  );
});

export default ThickArrowHelper;