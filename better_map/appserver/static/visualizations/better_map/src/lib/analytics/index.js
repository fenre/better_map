/*
 * Analytics module aggregator.
 *
 * One import surface for the visualization shell:
 *   import * as analytics from './lib/analytics';
 *   const grid = analytics.kde.compute(fc, { bandwidthMeters: 500 });
 *
 * Each sub-module is a pure function (no map state, no side effects)
 * so they can be unit-tested in isolation.
 *
 * BM-CT-1 notes: analytics are pure — enable/disable lives in the
 * layer that consumes the analytics output (e.g. the choropleth layer
 * for KDE results), not in the analytics function itself.
 */

import * as dbscan from './dbscan';
import * as getisOrd from './getisOrd';
import * as lisa from './lisa';
import * as kde from './kde';
import * as nnd from './nnd';
import * as spatialJoin from './spatialJoin';
import * as cimAutoDetect from './cimAutoDetect';

export {
    dbscan,
    getisOrd,
    lisa,
    kde,
    nnd,
    spatialJoin,
    cimAutoDetect
};

export default {
    dbscan: dbscan,
    getisOrd: getisOrd,
    lisa: lisa,
    kde: kde,
    nnd: nnd,
    spatialJoin: spatialJoin,
    cimAutoDetect: cimAutoDetect
};
