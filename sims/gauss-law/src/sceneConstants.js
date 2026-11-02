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

export const CHARGE_RADIUS = 0.15;

// What's selected for the properties panel is marked in this blue, the
// sidebar's "armed" color.
export const SELECTION_COLOR = '#3498db';

export const INITIAL_CAMERA_POSITION = [11, -14, 9];
export const INITIAL_CAMERA_TARGET = [0, 0, 0];
export const CAMERA_FOV = 35;

// The axis gizmo's center, in pixels from the viewer's lower-left corner:
// centered over the view controls' buttons (.view-controls in App.css,
// 108 px wide starting 16 px in) and high enough to clear them.
export const VIEW_CONTROLS_GIZMO_MARGIN = [70, 105];

// A pointerdown/pointerup pair counts as a "click" rather than a drag as
// long as the pointer moved no more than this many pixels in between --
// same threshold (and same idea) as the optics lab's CLICK_MOVE_THRESHOLD.
export const CLICK_MOVE_THRESHOLD = 4; // px
