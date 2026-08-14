// Shared color palette for placed detectors -- kept in its own module
// (rather than exported from LabPanel.jsx) so files that export React
// components can export *only* components, which is what lets Vite's Fast
// Refresh hot-swap them without a full page reload. Mirrors the Stern-
// Gerlach sim's palette (sims/stern-gerlach/src/colors.js) so a color/count
// combo reads consistently for anyone who's used both sims.
export const PC_COLORS = ['#28b563', '#e74c3c', '#3450db', '#937708', '#9b59b6', '#db6f11', '#0dc493', '#34495e'];
