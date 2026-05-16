/*
 * Splunk integration modules.
 *
 * One import surface so the viz shell can write:
 *   import * as splunk from './lib/splunk';
 *   splunk.itsi.configure({ baseUrl: ... });
 */

import * as rest from './rest';
import * as mitre from './mitre';
import * as esNotable from './esNotable';
import * as itsi from './itsi';
import * as soar from './soar';
import * as rba from './rba';
import * as purdue from './purdue';
import * as aiGeo from './aiGeo';
import * as correlationSearchBuilder from './correlationSearchBuilder';
import * as aiAssistant from './aiAssistant';

export {
    rest,
    mitre,
    esNotable,
    itsi,
    soar,
    rba,
    purdue,
    aiGeo,
    correlationSearchBuilder,
    aiAssistant
};

export default {
    rest: rest,
    mitre: mitre,
    esNotable: esNotable,
    itsi: itsi,
    soar: soar,
    rba: rba,
    purdue: purdue,
    aiGeo: aiGeo,
    correlationSearchBuilder: correlationSearchBuilder,
    aiAssistant: aiAssistant
};
