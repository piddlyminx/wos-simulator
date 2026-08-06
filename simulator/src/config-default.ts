// Standalone Node/TSX consumers resolve this module directly. Next's Webpack
// build replaces it with config-webpack.ts so browser bundles never import fs.
export { loadSimulatorConfig } from "./config-node";
