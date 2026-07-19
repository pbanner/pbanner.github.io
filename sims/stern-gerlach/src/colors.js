// Shared color palette for particle counters -- kept in its own module
// (rather than exported from LabPanel.jsx) so files that export React
// components can export *only* components, which is what lets Vite's Fast
// Refresh hot-swap them without a full page reload.
export const PC_COLORS = ['#3498db', '#e74c3c', '#28b563', '#937708', '#9b59b6', '#db6f11', '#0dc493', '#34495e'];