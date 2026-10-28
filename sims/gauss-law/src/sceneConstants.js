// Shared constants for the 3D scene. Plain data, no React, so both
// components and the pure geometry helpers can import from here.
//
// Coordinates are physics-style: z is "up" (the camera's `up` vector is set
// to +z in Viewer.jsx), and the floor grid lies in the z = 0 plane. That
// way positions in state read the same way students would write them
// (x, y along the floor, z = height) with no conversion layer between
// physics coordinates and three.js ones.

// The playable region is the cube [-WORLD_HALF_EXTENT, WORLD_HALF_EXTENT]^3.
// The floor grid spans the same range in x and y.
export const WORLD_HALF_EXTENT = 5;

export const INITIAL_CAMERA_POSITION = [11, -14, 9];
export const INITIAL_CAMERA_TARGET = [0, 0, 0];
export const CAMERA_FOV = 35;
