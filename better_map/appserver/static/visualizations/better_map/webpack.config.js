/*
 * webpack config for the Better Map Splunk custom visualization.
 *
 * Constraints:
 *   - Splunk's AMD loader is the only consumer, so library.type = 'amd'.
 *   - Splunk Web has historically run on older Chromium engines, so we emit
 *     plain ES5: target: ['web', 'es5'] + output.environment.* = false.
 *   - api/SplunkVisualizationBase and api/SplunkVisualizationUtils are
 *     resolved at runtime by Splunk's RequireJS - they must be externals.
 *   - The built bundle MUST begin with `define([...], function(` (not an
 *     arrow callback); the build script verifies this.
 *   - CRITICAL: `output.library.export = 'default'` MUST be set. Without it,
 *     webpack wraps the source's `export default SplunkVisualizationBase
 *     .extend({...})` as `{ default: vizClass, __esModule: true }` and the
 *     AMD `define()` callback returns THAT object. Splunk Dashboard Studio
 *     then receives the wrapper object instead of the viz constructor,
 *     silently fails to instantiate it, and shows the grey placeholder
 *     icon. With `export: 'default'`, webpack unwraps the default export
 *     and the AMD callback returns the constructor directly — matching
 *     the pattern hand-written AMD modules (like every viz in
 *     `rcastley/splunk-custom-visualizations`) emit naturally.
 */

var path = require('path');

module.exports = {
    target: ['web', 'es5'],
    entry: './src/visualization_source.js',
    output: {
        filename: 'visualization.js',
        path: path.resolve(__dirname),
        library: {
            type: 'amd',
            export: 'default'
        },
        environment: {
            arrowFunction: false,
            const: false,
            destructuring: false,
            forOf: false,
            bigIntLiteral: false,
            dynamicImport: false,
            module: false,
            optionalChaining: false,
            templateLiteral: false
        }
    },
    externals: [
        'api/SplunkVisualizationBase',
        'api/SplunkVisualizationUtils'
    ],
    module: {
        rules: [
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader']
            }
        ]
    },
    resolve: {
        extensions: ['.js', '.json']
    },
    performance: {
        // Better Map is a single-bundle visualization shipped with MapLibre,
        // PMTiles, h3-js, DOMPurify and supercluster. The combined gzipped
        // size sits around 750 KB - large for typical webpack apps but normal
        // for a full WebGL map. Disable the default warnings.
        hints: false
    }
};
