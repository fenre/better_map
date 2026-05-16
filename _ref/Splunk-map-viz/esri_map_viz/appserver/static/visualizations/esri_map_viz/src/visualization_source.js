/*
 * ESRI Web Map — Splunk Custom Visualization (v3.1)
 *
 * Interactive map rendering ESRI web service layers (tiles, features,
 * dynamic maps) with SPL search result overlay using Leaflet + esri-leaflet.
 *
 * Expected SPL columns: latitude, longitude
 * Optional: description, geojson, _color, _radius, _weight, _icon, _iconUrl,
 *           _label, _legend, _intensity, _startTime, _endTime
 */

var L = require('leaflet');
var EsriLeaflet = require('esri-leaflet');
var leafletCSS = require('leaflet/dist/leaflet.css');
require('leaflet.markercluster');
var markerClusterCSS = require('leaflet.markercluster/dist/MarkerCluster.css');
var markerClusterDefaultCSS = require('leaflet.markercluster/dist/MarkerCluster.Default.css');

require('leaflet.heat');
var EsriLeafletGeocode = require('esri-leaflet-geocoder');
var geocoderCSS = require('esri-leaflet-geocoder/dist/esri-leaflet-geocoder.css');
require('leaflet-draw');
var drawCSS = require('leaflet-draw/dist/leaflet.draw.css');
require('leaflet-minimap');
var minimapCSS = require('leaflet-minimap/dist/Control.MiniMap.min.css');
var SideBySide = require('leaflet-side-by-side');
require('esri-leaflet-renderers');
var EsriLeafletCluster = require('esri-leaflet-cluster');

var SplunkVisualizationBase = require('api/SplunkVisualizationBase');
var SplunkVisualizationUtils = require('api/SplunkVisualizationUtils');

function getOption(config, ns, key, defaultValue) {
    var v = config[ns + key];
    if (v !== undefined && v !== null) return v;
    v = config[key];
    if (v !== undefined && v !== null) return v;
    return defaultValue;
}

// ── Calcite Point Symbol Icon Library (Esri) ─────────────────────
var ICON_LIBRARY = {
    'airplane': 'M18.238 14.143c0-.633-.814-1.266-.814-1.266L11.9 8.83V5.238A3.614 3.614 0 0 0 10.5 2a3.614 3.614 0 0 0-1.4 3.238V8.83l-5.524 4.047s-.814.633-.814 1.266v.808L9.1 12.523a30.101 30.101 0 0 0 .42 3.655L8.056 17.58s-.408.317-.408.633V19l2.851-.77 2.85.77v-.787c0-.316-.407-.633-.407-.633l-1.463-1.402a30.101 30.101 0 0 0 .42-3.655l6.338 2.428z',
    'car': 'M19.556 9.452L14.907 8 12.67 5.155A.678.678 0 0 0 12.238 5H6a.679.679 0 0 0-.525.248L4.035 8H2a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h2.092a1.5 1.5 0 1 0 2.816 0h7.184a1.5 1.5 0 1 0 2.816 0H19a1 1 0 0 0 1-1V9.97c0-.285-.177-.42-.444-.518zM6.576 6H9v2H5.529zM10 8V6h2.062l1.573 2z',
    'fire-station': 'M10.5 1.999v-.001c-.004.006-2.147 2.691-6.5 2.625v4.1c0 3.664.397 7.887 6.5 10.275C16.603 16.61 17 12.387 17 8.724V4.623c-4.353.066-6.496-2.619-6.5-2.624zm3.31 7.843c.004.694.226 1.384.178 2.077-.117 1.716-1.696 3.079-3.488 3.079-1.716 0-3.138-1.179-3.436-2.731-.037-.623.048-1.224.378-1.775.772-1.286 2.418-1.775 3.244-3.02 1.05-1.583.584-2.474.584-2.474s1.082.824.85 2.096c-.235 1.273-.602 1.75-1.615 2.815-1.013 1.064-.675 2.099.57 1.929 1.247-.172 1.275-.494 1.538-1.706.262-1.21 1.926-1.595 1.926-1.595s-.734.528-.73 1.305z',
    'hospital': 'M3.506 10.798A6.826 6.826 0 0 1 3 8.306a3.922 3.922 0 0 1 3.75-4.304 4.191 4.191 0 0 1 3.75 2.153 4.191 4.191 0 0 1 3.75-2.153A3.922 3.922 0 0 1 18 8.306a6.827 6.827 0 0 1-.507 2.493l-2.37.002-1.666-3.337-1.181 3.783-1.795-3.75-1.874 4.79-.46-1.49zm10.87 1.4l-.813-1.627-1 4-2.042-4.085-2.038 5.093-1.127-3.38h-3.17a19.113 19.113 0 0 0 6.314 5.799 19.113 19.113 0 0 0 6.314-5.8z',
    'ambulance': 'M11 4h-1V2h1zm-3.047.424L6.58 3.05l-.521.522L7.43 4.945zm5.616.521l1.372-1.372-.521-.522-1.373 1.373zM19 16h-2.058a1.237 1.237 0 0 1 .058.288v.423A1.288 1.288 0 0 1 15.712 18h-.424A1.288 1.288 0 0 1 14 16.711v-.423a1.237 1.237 0 0 1 .058-.288H6.942a1.237 1.237 0 0 1 .058.288v.423A1.288 1.288 0 0 1 5.712 18h-.424A1.288 1.288 0 0 1 4 16.711v-.423A1.237 1.237 0 0 1 4.058 16H2v-4h1.823l1.636 2.8L7.5 10.6 8.6 12H11v-1H9.1L7.526 8.3 5.44 12.6 4.477 11H2V7h7v-.825A1.175 1.175 0 0 1 10.175 5h.65A1.175 1.175 0 0 1 12 6.175V7h2l2.8 4 2.2 2zm-3.4-5l-1.9-3H12v3z',
    'bus': 'M5 16.5a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5V15h7v1.5a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5V15h1V6c0-1.907-3.625-3-6.5-3S4 4.092 4 6v9h1zm11-3a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5zM7 5h7v1H7zM5 7h11v4H5zm0 5.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5z',
    'train': 'M16 12.998v-2.55a5.48 5.48 0 0 0-.072-.887c-.947-5.802-.84-7.563-2.928-7.563H8c-2.09 0-1.983 1.773-2.928 7.563-.048.291-.072.59-.072.886v2.551a2 2 0 0 0 2 2l-2 3h2l1-3h5l1 3h2l-2-3a2 2 0 0 0 2-2zm-5.5.3c-.44 0-.8-.36-.8-.8s.36-.8.8-.8c.44 0 .8.36.8.8s-.36.8-.8.8zm0-3.3l-3.703-1 .8-4h5.805l.801 4-3.703 1z',
    'ship': 'M11 2.998h-1v-1h1v1zm-.5 3.072L6.945 7.58l.768-2.582h.744L8.827 3h3.345l.371 1.998h.744l.768 2.582L10.5 6.07zM9.385 4.998h2.23l-.558-1H9.943l-.558 1zM7.356 15.233c1.087 0 2.141.336 3.144 1 1.003-.664 2.057-.999 3.145-.999.447 0 .856.067 1.235.162.097-.89.497-3.326 2.002-5.079L10.5 7.606l-6.382 2.711c1.506 1.754 1.905 4.19 2.001 5.079.38-.094.787-.163 1.237-.163zM13.645 17c-1.078 0-2.134.364-3.145 1.083-1.01-.72-2.067-1.084-3.144-1.084-1.652 0-2.759.876-2.77.886-.077.063-.076.165.002.228l.394.32c.039.031.09.047.141.047.05 0 .102-.016.14-.047.086-.068.872-.669 2.066-.669.948 0 1.902.378 2.836 1.123a.534.534 0 0 0 .336.112.552.552 0 0 0 .34-.116c.928-.739 1.88-1.115 2.827-1.115 1.242 0 2.058.658 2.066.664a.226.226 0 0 0 .142.049.228.228 0 0 0 .142-.048l.394-.32c.078-.063.078-.166 0-.23-.011-.008-1.109-.883-2.767-.883z',
    'bridge': 'M19 7.898v-.8a4.35 4.35 0 0 1-3-1.811V2.998h-1v1.653l-.083.181c-.015.032-1.53 3.266-4.417 3.266S6.098 4.864 6.083 4.832L6 4.652V2.997H5v2.355a5.81 5.81 0 0 1-3 1.736v.817A7.331 7.331 0 0 0 5 6.48v4.517H2v3h3v2H4v2h3v-2H6v-2h9v2h-1v2h3v-2h-1v-2h3v-3h-3V6.471a4.48 4.48 0 0 0 3 1.427zm-4 3.1H6V6.251a5.64 5.64 0 0 0 4.5 2.647 5.639 5.639 0 0 0 4.5-2.65z',
    'parking': 'M19 5.998v1.2l-8.5-3-8.5 3v-1.2l8.5-3 8.5 3zm-2.133 5.623c.088.175.133.367.133.563v4.204a.61.61 0 0 1-.61.61H16v.666c0 .185-.15.334-.333.334h-1.334a.333.333 0 0 1-.333-.334v-.666H7v.666c0 .185-.15.334-.334.334H5.333A.333.333 0 0 1 5 17.664v-.666h-.39a.61.61 0 0 1-.611-.61v-4.204c0-.196.045-.388.133-.563l1.963-3.927a1.26 1.26 0 0 1 1.127-.696h6.554c.477 0 .913.27 1.127.696l1.963 3.927zM6 12.998H5v1h1v-1zm9.873-1l-1.927-3.856a.257.257 0 0 0-.233-.144H7.16c-.1 0-.189.055-.233.144L5 11.998h10.873zm.127 1h-1v1h1v-1z',
    'school': 'M17 16.998v-10h-6v-2l3-1.5-3-1.5h-1v5H4v10H3v1h15v-1zm-9-2H5v-2h3zm0-4H5v-2h3zm4 4H9v-2h3zm0-4H9v-2h3zm4 4h-3v-2h3zm0-4h-3v-2h3z',
    'food': 'M17.5 13a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1zM12 16h4a1 1 0 0 0 1-1h-6a1 1 0 0 0 1 1zm-1-5v1h6v-1c0-2.667-6-2.667-6 0zm-1-1.231V17a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1.001l.009-7.229c0-.99 1.288-1.703 1.288-1.703L6.67 4H6v-.997L5.999 3H9v1h-.672l.373 4.067S10 8.779 10 9.769zM7 10H6v5h1z',
    'bank': 'M4 7H2V6l7-3 7 3v1h-2v4h-2V7h-2v4a1 1 0 0 0-1 1v1H8V7H6v6H4zm-.929 7A1.038 1.038 0 0 0 2 15v1h7v-2zM10 12v5h9v-5zm2 2h-1v-1h1zm2.5 2c-.552 0-1-.672-1-1.5s.448-1.5 1-1.5 1 .672 1 1.5-.448 1.5-1 1.5zm3.5 0h-1v-1h1z',
    'power-plant': 'M16.8 3.998h-2.6l-.571 8H12v-4H3v10h14.8zm-10.9 13.1l1.503-4.1H4.8l1.405-4H9.5l-2.802 3H10.5z',
    'gas-station': 'M16.94 12.512l-.765-3.065A5.853 5.853 0 0 1 16 8.027V6.498a1.5 1.5 0 0 0-1.5-1.5H14v-1.5a.5.5 0 0 0-.5-.5h-8a.5.5 0 0 0-.5.5v14.5h9v-3.277c.295.171.634.277 1 .277a2 2 0 0 0 1.94-2.486zM13 8.998H6v-4h7v4zm2 5a1 1 0 0 1-1-1v-5h1v.17c0 .552.07 1.1.208 1.634l.76 2.945.003.006h-.001a1 1 0 0 1-.97 1.245z',
    'shopping': 'M14 7.998v-2.5a3.5 3.5 0 0 0-7 0v2.5H4v11h13v-11zm-6-2.5a2.5 2.5 0 0 1 5 0v2.5H8zm0 4.5H7v-1h1zm6 0h-1v-1h1z',
    'information': 'M10.5 2.198a8.3 8.3 0 1 0 0 16.6 8.3 8.3 0 0 0 0-16.6zm1.1 13.8H9.4v-7h2.2v7zm.2-9.067a.87.87 0 0 1-.867.867h-.866a.87.87 0 0 1-.867-.867v-.866a.87.87 0 0 1 .867-.867h.866a.87.87 0 0 1 .867.867v.866z',
    'star': 'M10.5 2.427l1.81 5.571h5.857l-4.738 3.443 1.81 5.57L10.5 13.57l-4.739 3.443 1.81-5.571-4.739-3.443H8.69z',
    'wifi': 'M17 16.969V20H4v-3.031A1.969 1.969 0 0 1 5.969 15h2.185a2.399 2.399 0 0 1 4.692 0h2.185A1.969 1.969 0 0 1 17 16.969zm-9.898-6.866l.57.82a4.971 4.971 0 0 1 5.656 0l.57-.82a5.97 5.97 0 0 0-6.796 0zm9.562-2.678a9.225 9.225 0 0 0-12.328 0l.669.744a8.222 8.222 0 0 1 10.99 0zM10.5 1.077a12.486 12.486 0 0 0-8.87 3.68l.708.707a11.528 11.528 0 0 1 16.324 0l.707-.707a12.486 12.486 0 0 0-8.87-3.68z',
    'dam': 'M11 16.998h6l-3-14h-3zM10 6.901v1.063c-.103.01-.693.034-.693.034A3.672 3.672 0 0 1 6.5 6.504a3.672 3.672 0 0 1-2.807 1.494s-.59-.024-.693-.034V6.9a5.693 5.693 0 0 0 .621.05c1.071 0 2.05-1.121 2.879-1.953.829.832 1.808 1.953 2.879 1.953A5.693 5.693 0 0 0 10 6.9zm0 4.002v1.06c-.103.01-.693.035-.693.035A3.672 3.672 0 0 1 6.5 10.504a3.672 3.672 0 0 1-2.807 1.494s-.59-.024-.693-.035v-1.06a5.544 5.544 0 0 0 .621.048c1.071 0 2.05-1.122 2.879-1.953.829.831 1.808 1.953 2.879 1.953a5.544 5.544 0 0 0 .621-.048zm0 3.998v1.063c-.103.01-.693.034-.693.034A3.672 3.672 0 0 1 6.5 14.504a3.672 3.672 0 0 1-2.807 1.494s-.59-.024-.693-.034V14.9a5.693 5.693 0 0 0 .621.05c1.071 0 2.05-1.121 2.879-1.953.829.832 1.808 1.953 2.879 1.953A5.693 5.693 0 0 0 10 14.9z',
    'windmill': 'M12.498 9.987a2.435 2.435 0 0 0 .454-1.962C19.152 8.173 20 9 20 9s-.876.87-7.502.987zM10.5 6a2.453 2.453 0 0 1 .314.032C8.525.912 7.513.46 7.513.46s-.398 1.002 1.454 6.08A2.475 2.475 0 0 1 10.5 6zm0 5a2.495 2.495 0 0 1-2.103-1.16c-3.047 4.455-2.912 5.526-2.912 5.526s1.034-.167 4.323-4.257L9 20h3l-.828-9.104A2.467 2.467 0 0 1 10.5 11zm0-4A1.5 1.5 0 1 0 12 8.5 1.5 1.5 0 0 0 10.5 7z',
    'pin-tear': 'M10.5 1.998a5.4 5.4 0 0 0-5.4 5.4c0 2.982 3.9 6.6 5.4 11.6 1.521-4.98 5.4-8.618 5.4-11.6a5.4 5.4 0 0 0-5.4-5.4zm0 7.8a2.3 2.3 0 1 1 0-4.599 2.3 2.3 0 0 1 0 4.599z',
    'flag': 'M13.25 4.498c-1.295 0-2.205-1.042-3.5-1.042S8 3.998 8 3.998v-1H7v16h1v-8s.455-.542 1.75-.542 2.205 1.042 3.5 1.042 1.75-.5 1.75-.5v-7s-.455.5-1.75.5z',
    'building': 'M16 15.998v-13H5v13H4v1h5v-3h3v3h5v-1zm-6-3H7v-2h3zm0-3H7v-2h3zm0-3H7v-2h3zm4 6h-3v-2h3zm0-3h-3v-2h3zm0-3h-3v-2h3z',
    'house': 'M18 9.998v-1l-7.5-6-7.5 6v1h1v6H3v1h15v-1h-1v-6h1zm-12 0h3v3H6v-3zm6 6v-6h3v6h-3z',
    'place-of-worship': 'M16.718 7.16a.228.228 0 0 0-.436 0l-1.233 3.676a.228.228 0 0 1-.219.162S12 8.124 12 7.998c0 0-.003-1.979-.01-2L10.718 2.16a.228.228 0 0 0-.436 0L9.01 5.998c-.007.021-.01 2-.01 2 0 .126-2.83 3-2.83 3a.229.229 0 0 1-.219-.162L4.718 7.16a.228.228 0 0 0-.436 0L3 10.998c-.006.021 0 6.772 0 6.772 0 .126.102.228.228.228H9v-3.422c0-.318.37-.578.822-.578h1.356c.452 0 .822.26.822.578v3.422h5.772A.228.228 0 0 0 18 17.77v-6.772c0-.022-1.282-3.838-1.282-3.838zM6.047 14.998h-1v-2h1v2zM10.5 11.25a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zm5.547 3.748h-1v-2h1v2z',
    'anchor': 'M17.966 10.268l-3.957 2.23 1.362.964a7.139 7.139 0 0 1-3.51 1.912l-.722-6.376H15v-1h-3.975l-.118-1.041a2.495 2.495 0 0 0-.407-4.959 2.495 2.495 0 1 0-.407 4.959l-.118 1.041H6v1h3.861l-.723 6.376a6.974 6.974 0 0 1-3.495-1.922l1.348-.954-3.957-2.23.448 4.713 1.268-.897c1.182 1.69 2.87 2.782 4.747 3.07L10 18.998h1l.503-1.843c1.887-.29 3.584-1.385 4.778-3.05l1.237.876.448-4.713zM9 4.498c0-.827.673-1.5 1.5-1.5s1.5.673 1.5 1.5-.673 1.5-1.5 1.5S9 5.325 9 4.498z',
    'bell': 'M9.03 3.206a1.5 1.5 0 0 1 2.94 0 5.361 5.361 0 0 0-2.94 0zM15 12V8.5a4.5 4.5 0 0 0-9 0V12a2 2 0 0 1-2 2v1h13v-1a2 2 0 0 1-2-2zm-6 4.053a1.5 1.5 0 0 0 3 0V16H9z',
    'person': 'M13.8 6.498a3.3 3.3 0 1 1-6.6 0 3.3 3.3 0 0 1 6.6 0zm3.175 10.5c-.256-3.355-3.054-6-6.475-6s-6.219 2.645-6.475 6h12.95z',
    'people': 'M15.5 8.546a2.05 2.05 0 1 0-2.05-2.05 2.05 2.05 0 0 0 2.05 2.05zm-8.146 2.113A3.008 3.008 0 0 0 5.5 9.998c-1.843 0-3.35 1.762-3.487 3.998h4.52a5.567 5.567 0 0 1 2.096-1.597c-.03-.074-.07-.138-.103-.209a3.364 3.364 0 0 1-1.172-1.531zm8.146-.661a3.016 3.016 0 0 0-1.887.686 3.364 3.364 0 0 1-1.126 1.48c-.038.08-.083.153-.116.235a5.565 5.565 0 0 1 2.095 1.597h4.521c-.138-2.236-1.644-3.998-3.487-3.998zm-10-1.452a2.05 2.05 0 1 0-2.05-2.05 2.05 2.05 0 0 0 2.05 2.05zm7.337.95a2.35 2.35 0 1 1-2.35-2.35 2.35 2.35 0 0 1 2.35 2.35zM6 17.998c.178-2.796 2.122-5 4.5-5s4.322 2.204 4.5 5z',
    'biohazard': 'M11.506 1.888a5.127 5.127 0 0 1 3.776 6.88 5.128 5.128 0 0 1 4.078 6.692l-.393-.227c.062-.261.103-.53.103-.811a3.52 3.52 0 0 0-3.52-3.52 3.511 3.511 0 0 0-2.881 1.508l-.744-.43c.05-.15.083-.307.083-.474 0-.73-.518-1.338-1.206-1.478v-.865a3.508 3.508 0 0 0 3.217-3.49 3.508 3.508 0 0 0-2.513-3.355v-.43zm6.455 15.087a3.499 3.499 0 0 1-2.41.966 3.52 3.52 0 0 1-3.52-3.52c0-.533.128-1.033.34-1.486l-.747-.432c-.277.311-.675.511-1.124.511s-.847-.2-1.124-.51l-.747.43a3.5 3.5 0 0 1 .34 1.488 3.52 3.52 0 0 1-3.52 3.52 3.5 3.5 0 0 1-2.41-.967l-.396.228a5.125 5.125 0 0 0 7.857-.153 5.125 5.125 0 0 0 7.857.154l-.396-.23zM2.033 15.233a3.501 3.501 0 0 1-.103-.811 3.52 3.52 0 0 1 3.52-3.52c1.193 0 2.245.599 2.881 1.508l.744-.43a1.492 1.492 0 0 1-.083-.474c0-.73.518-1.338 1.206-1.478v-.865a3.508 3.508 0 0 1-3.217-3.49 3.508 3.508 0 0 1 2.513-3.355v-.43a5.127 5.127 0 0 0-3.776 6.88A5.128 5.128 0 0 0 1.64 15.46l.393-.227zm5.76-8.518c.122.324.301.616.524.873C8.966 7.225 9.703 7 10.5 7s1.534.225 2.183.588c.223-.257.402-.549.524-.873a5.47 5.47 0 0 0-5.414 0zm5.5 9.517a2.879 2.879 0 0 1-.497-.881 4.48 4.48 0 0 0 2.199-3.798c.171-.031.347-.053.528-.053.162 0 .32.022.475.048a5.491 5.491 0 0 1-2.704 4.684zm-8.29-4.684c.155-.026.312-.048.474-.048.181 0 .357.022.528.053a4.48 4.48 0 0 0 2.199 3.798c-.114.325-.283.62-.498.88a5.491 5.491 0 0 1-2.704-4.683z',
    'mining': 'M14.854 7.645l-3.336 3.775 3.606 4.174 1.282-1.281.713.713-3.64 3.64-.714-.713 1.251-1.25-3.552-4.091-4.18 4.834-1.191-1.01L9.42 11.41 8.046 9.736 6.31 11.432S2.955 7.575 3.944 4.758c2.817-.99 6.675 2.465 6.675 2.465L9.184 8.624l1.29 1.588 3.429-3.896c-.574-1.321-1.13-2.156-1.669-2.505a17.82 17.82 0 0 0-1.064-.693 77.48 77.48 0 0 0-1.045-.618c1.517.125 3.014.749 4.491 1.873.406.298 1.185 1.076 2.35 2.334l1.101 1.197c.23.264.431.488.602.677l-1.32 1.307-2.495-2.243z',
    'circle': 'M10.5 4.201a6.3 6.3 0 1 0 0 12.6 6.3 6.3 0 1 0 0-12.6z',
    'square': 'M2 1.998h17v17H2z',
    'diamond': 'M3 10.498l7.5-7.5 7.501 7.5-7.5 7.5z',
    'triangle': 'M4.731 14.998l5.769-10.5 5.769 10.5z'
};

// ── Basemap definitions ───────────────────────────────────────────
var BASEMAPS = {
    'osm': { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '\u00a9 OpenStreetMap contributors', maxZoom: 19 },
    'esri-streets': { url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', attribution: '\u00a9 Esri', maxZoom: 18 },
    'esri-imagery': { url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: '\u00a9 Esri', maxZoom: 18 },
    'esri-topo': { url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', attribution: '\u00a9 Esri', maxZoom: 18 },
    'esri-dark-gray': { url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', attribution: '\u00a9 Esri', maxZoom: 16 },
    'esri-light-gray': { url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', attribution: '\u00a9 Esri', maxZoom: 16 },
    'esri-nat-geo': { url: 'https://services.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}', attribution: '\u00a9 Esri, National Geographic', maxZoom: 16 },
    'none': null
};

// ── Helpers ───────────────────────────────────────────────────────

function parseGeoJSON(str) {
    if (!str || typeof str !== 'string') return null;
    try { return JSON.parse(str); } catch (e) { return null; }
}

function escapePopup(str) {
    return SplunkVisualizationUtils.escapeHtml(String(str));
}

function buildPopupHTML(row, colIdx, fieldNames) {
    var parts = [];
    for (var i = 0; i < fieldNames.length; i++) {
        var fn = fieldNames[i];
        if (fn.charAt(0) === '_') continue;
        if (fn === 'geojson') continue;
        var idx = colIdx[fn];
        if (idx === undefined) continue;
        var val = row[idx];
        if (val !== null && val !== undefined && val !== '') {
            parts.push('<b>' + escapePopup(fn) + '</b>: ' + escapePopup(val));
        }
    }
    return parts.join('<br>');
}

function createSvgIconHtml(iconName, color, size) {
    var pathData = ICON_LIBRARY[iconName];
    if (!pathData) return null;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" width="' + size + '" height="' + size + '" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5))"><path d="' + pathData + '" fill="' + color + '"/></svg>';
}

function hexToRgba(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function formatDistance(meters) {
    if (meters >= 1000) return (meters / 1000).toFixed(2) + ' km';
    return meters.toFixed(0) + ' m';
}

function buildServicePopupHTML(properties) {
    if (!properties) return '';
    var parts = [];
    for (var key in properties) {
        if (!properties.hasOwnProperty(key)) continue;
        if (key === 'OBJECTID' || key === 'Shape' || key === 'Shape_Length' || key === 'Shape_Area' || key === 'Shape.STLength()' || key === 'Shape.STArea()') continue;
        var val = properties[key];
        if (val === null || val === undefined || val === '') continue;
        parts.push('<b>' + escapePopup(key) + '</b>: ' + escapePopup(String(val)));
    }
    return parts.length > 0 ? '<div style="max-height:250px;overflow-y:auto">' + parts.join('<br>') + '</div>' : '';
}

// ── CSS Injection ─────────────────────────────────────────────────

var LEAFLET_CRITICAL_CSS = [
    '.leaflet-pane,.leaflet-tile,.leaflet-marker-icon,.leaflet-marker-shadow,',
    '.leaflet-tile-container,.leaflet-pane > svg,.leaflet-pane > canvas,',
    '.leaflet-zoom-box,.leaflet-image-layer,.leaflet-layer {',
    '  position: absolute; left: 0; top: 0;',
    '}',
    '.leaflet-container { overflow: hidden; -webkit-tap-highlight-color: transparent; }',
    '.leaflet-tile, .leaflet-marker-icon, .leaflet-marker-shadow { -webkit-user-select: none; user-select: none; -webkit-user-drag: none; }',
    '.leaflet-tile { filter: inherit; visibility: hidden; }',
    '.leaflet-tile-loaded { visibility: visible; }',
    '.leaflet-tile-pane { z-index: 200; }',
    '.leaflet-overlay-pane { z-index: 400; }',
    '.leaflet-shadow-pane { z-index: 500; }',
    '.leaflet-marker-pane { z-index: 600; }',
    '.leaflet-tooltip-pane { z-index: 650; }',
    '.leaflet-popup-pane { z-index: 700; }',
    '.leaflet-map-pane canvas { z-index: 100; }',
    '.leaflet-map-pane svg { z-index: 200; }',
    '.leaflet-control { position: relative; z-index: 800; pointer-events: visiblePainted; pointer-events: auto; float: left; clear: both; }',
    '.leaflet-top, .leaflet-bottom { position: absolute; z-index: 1000; pointer-events: none; }',
    '.leaflet-top { top: 0; } .leaflet-right { right: 0; } .leaflet-bottom { bottom: 0; } .leaflet-left { left: 0; }',
    '.leaflet-right .leaflet-control { float: right; clear: right; }',
    '.leaflet-top .leaflet-control { margin-top: 10px; }',
    '.leaflet-bottom .leaflet-control { margin-bottom: 10px; }',
    '.leaflet-left .leaflet-control { margin-left: 10px; }',
    '.leaflet-right .leaflet-control { margin-right: 10px; }',
    '.leaflet-fade-anim .leaflet-tile { will-change: opacity; }',
    '.leaflet-fade-anim .leaflet-popup { opacity: 0; transition: opacity 0.2s linear; }',
    '.leaflet-fade-anim .leaflet-map-pane .leaflet-popup { opacity: 1; }',
    '.leaflet-zoom-animated { transform-origin: 0 0; }',
    '.leaflet-zoom-anim .leaflet-zoom-animated { will-change: transform; transition: transform 0.25s cubic-bezier(0,0,0.25,1); }',
    '.leaflet-zoom-anim .leaflet-tile, .leaflet-pan-anim .leaflet-tile { transition: none; }',
    '.leaflet-interactive { cursor: pointer; }',
    '.leaflet-grab { cursor: -webkit-grab; cursor: grab; }',
    '.leaflet-crosshair, .leaflet-crosshair .leaflet-interactive { cursor: crosshair; }',
    '.leaflet-control-zoom a { width: 30px; height: 30px; line-height: 30px; display: block; text-align: center; text-decoration: none; font: bold 18px "Lucida Console", Monaco, monospace; }',
    '.leaflet-container img { max-width: none !important; max-height: none !important; padding: 0; }',
    '.leaflet-container img.leaflet-tile { width: 256px; height: 256px; }',
    '.leaflet-tile-container { pointer-events: none; }',
    'img.leaflet-tile { outline: 0; }',
    '.leaflet-tooltip { position: absolute; padding: 6px; background-color: #1A1A2E; border: 1px solid #2C2C3A; border-radius: 4px; color: #C3CBD4; white-space: nowrap; pointer-events: none; box-shadow: 0 2px 8px rgba(0,0,0,0.4); font-size: 11px; z-index: 650; }',
    '.leaflet-tooltip-top:before { border-top-color: #2C2C3A; }',
    '.leaflet-tooltip-bottom:before { border-bottom-color: #2C2C3A; }',
    '.leaflet-tooltip-left:before { border-left-color: #2C2C3A; }',
    '.leaflet-tooltip-right:before { border-right-color: #2C2C3A; }',
].join('\n');

var CUSTOM_CSS = [
    '.leaflet-container { background: #1a1a2e; font-family: sans-serif; }',
    '.leaflet-control-zoom a { background: #2C2C3A !important; color: #C3CBD4 !important; border-color: #3C3C4A !important; }',
    '.leaflet-control-zoom a:hover { background: #3C3C4A !important; color: #FFFFFF !important; }',
    '.leaflet-control-attribution { background: rgba(26,26,46,0.8) !important; color: #888 !important; font-size: 10px; }',
    '.leaflet-control-attribution a { color: #00A4FD !important; }',
    '.leaflet-control-scale-line { background: rgba(26,26,46,0.8); color: #C3CBD4; border-color: #C3CBD4; }',
    '.leaflet-popup-content-wrapper { background: #1A1A2E; color: #C3CBD4; border: 1px solid #2C2C3A; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.4); }',
    '.leaflet-popup-tip { background: #1A1A2E; border: 1px solid #2C2C3A; }',
    '.leaflet-popup-content { margin: 10px 14px; font-size: 12px; line-height: 1.5; }',
    '.leaflet-popup-content b { color: #00A4FD; }',
    '.leaflet-popup-close-button { color: #888 !important; }',
    '.leaflet-popup-close-button:hover { color: #FFF !important; }',
    '.esri-map-viz img, .esri-map-viz .leaflet-container img { max-width: none !important; max-height: none !important; padding: 0 !important; border: 0 !important; margin: 0 !important; }',
    '.esri-map-viz .leaflet-tile { box-shadow: none !important; border-radius: 0 !important; }',
    '.esri-map-viz-icon { background: none !important; border: none !important; }',
    '.esri-map-viz-icon svg { display: block; }',
    '.esri-map-viz-legend { background: rgba(26,26,46,0.9); border: 1px solid #2C2C3A; border-radius: 8px; padding: 10px 14px; color: #C3CBD4; font-size: 11px; max-height: 200px; overflow-y: auto; pointer-events: auto; min-width: 100px; }',
    '.esri-map-viz-legend-title { font-weight: bold; font-size: 12px; margin-bottom: 6px; color: #F8FAFC; }',
    '.esri-map-viz-legend-item { display: flex; align-items: center; margin: 3px 0; gap: 6px; }',
    '.esri-map-viz-legend-swatch { width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.1); }',
    '.esri-map-viz-legend-icon { flex-shrink: 0; }',
    '.esri-map-viz-legend-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }',
    '.esri-map-viz-fullscreen { width: 30px; height: 30px; line-height: 30px; text-align: center; background: #2C2C3A !important; color: #C3CBD4 !important; border-color: #3C3C4A !important; cursor: pointer; font-size: 16px; display: block; text-decoration: none; }',
    '.esri-map-viz-fullscreen:hover { background: #3C3C4A !important; color: #FFFFFF !important; }',
    '.esri-map-viz-coords { background: rgba(26,26,46,0.85); border: 1px solid #2C2C3A; border-radius: 4px; padding: 4px 8px; color: #888; font-size: 10px; font-family: monospace; pointer-events: none; }',
    '.esri-map-viz-badge { background: rgba(0,164,253,0.9); color: #fff; font-size: 11px; font-weight: bold; padding: 3px 8px; border-radius: 12px; pointer-events: none; font-family: sans-serif; }',
    '.esri-map-viz-label { background: none !important; border: none !important; color: #F8FAFC; font-size: 10px; font-weight: bold; text-shadow: 0 0 4px rgba(0,0,0,0.8), 0 0 2px rgba(0,0,0,0.9); white-space: nowrap; text-align: center; }',
    '.marker-cluster-small { background-color: rgba(0,164,253,0.4); }',
    '.marker-cluster-small div { background-color: rgba(0,164,253,0.7); }',
    '.marker-cluster-medium { background-color: rgba(255,179,0,0.4); }',
    '.marker-cluster-medium div { background-color: rgba(255,179,0,0.7); }',
    '.marker-cluster-large { background-color: rgba(247,75,74,0.4); }',
    '.marker-cluster-large div { background-color: rgba(247,75,74,0.7); }',
    '.marker-cluster { background-clip: padding-box; border-radius: 20px; }',
    '.marker-cluster div { width: 30px; height: 30px; margin-left: 5px; margin-top: 5px; text-align: center; border-radius: 15px; font: 12px sans-serif; color: #fff; font-weight: bold; line-height: 30px; }',
    '.marker-cluster span { line-height: 30px; }',
    // Geocoder dark theme
    '.geocoder-control { font-family: sans-serif; }',
    '.geocoder-control-input { background: #2C2C3A !important; color: #C3CBD4 !important; border: 1px solid #3C3C4A !important; border-radius: 4px !important; height: 30px !important; font-size: 12px; }',
    '.geocoder-control-input:focus { border-color: #00A4FD !important; outline: none; }',
    '.geocoder-control-suggestions { background: #1A1A2E !important; border: 1px solid #2C2C3A !important; border-radius: 0 0 4px 4px; }',
    '.geocoder-control-suggestions .geocoder-control-suggestion { color: #C3CBD4; padding: 6px 10px; font-size: 11px; border-bottom: 1px solid #2C2C3A; }',
    '.geocoder-control-suggestions .geocoder-control-suggestion:hover, .geocoder-control-suggestions .geocoder-control-suggestion.geocoder-control-selected { background: #2C2C3A !important; color: #FFFFFF; }',
    '.geocoder-control-expanded .geocoder-control-input { width: 220px !important; }',
    // Draw controls dark theme
    '.leaflet-draw-toolbar a { background-color: #2C2C3A !important; color: #C3CBD4 !important; border-color: #3C3C4A !important; width: 30px; height: 30px; line-height: 30px; }',
    '.leaflet-draw-toolbar a:hover { background-color: #3C3C4A !important; color: #FFFFFF !important; }',
    '.leaflet-draw-actions { background: #1A1A2E !important; border: 1px solid #2C2C3A !important; }',
    '.leaflet-draw-actions li a { background: #2C2C3A !important; color: #C3CBD4 !important; font-size: 11px; }',
    '.leaflet-draw-actions li a:hover { background: #3C3C4A !important; color: #FFF !important; }',
    '.leaflet-draw-tooltip { background: #1A1A2E !important; border: 1px solid #2C2C3A !important; color: #C3CBD4 !important; font-size: 11px; }',
    '.leaflet-draw-tooltip-subtext { color: #888 !important; }',
    // Minimap dark theme
    '.leaflet-control-minimap { border: 2px solid #2C2C3A !important; border-radius: 4px !important; box-shadow: 0 2px 8px rgba(0,0,0,0.4) !important; }',
    '.leaflet-control-minimap-toggle-display { background-color: #2C2C3A !important; border-color: #3C3C4A !important; }',
    // Side-by-side
    '.leaflet-sbs-range { pointer-events: auto; cursor: ew-resize; }',
    '.leaflet-sbs-divider { background: #00A4FD; width: 2px; }',
    // Measure control
    '.esri-map-viz-measure-btn { width: 30px; height: 30px; line-height: 30px; text-align: center; background: #2C2C3A !important; color: #C3CBD4 !important; border-color: #3C3C4A !important; cursor: pointer; font-size: 14px; display: block; text-decoration: none; }',
    '.esri-map-viz-measure-btn:hover { background: #3C3C4A !important; color: #FFFFFF !important; }',
    '.esri-map-viz-measure-btn.active { background: #00A4FD !important; color: #FFF !important; }',
    '.esri-map-viz-measure-result { background: rgba(26,26,46,0.9); border: 1px solid #2C2C3A; border-radius: 4px; padding: 6px 10px; color: #C3CBD4; font-size: 11px; font-family: sans-serif; pointer-events: auto; white-space: nowrap; }',
    '.esri-map-viz-measure-result b { color: #00A4FD; }',
    '.esri-map-viz-measure-close { cursor: pointer; margin-left: 8px; color: #888; }',
    '.esri-map-viz-measure-close:hover { color: #FFF; }',
    // Timeline slider
    '.esri-map-viz-timeline { background: rgba(26,26,46,0.9); border: 1px solid #2C2C3A; border-radius: 8px; padding: 8px 14px; color: #C3CBD4; font-size: 11px; pointer-events: auto; min-width: 300px; }',
    '.esri-map-viz-timeline-label { font-weight: bold; font-size: 11px; margin-bottom: 4px; color: #F8FAFC; }',
    '.esri-map-viz-timeline input[type=range] { width: 100%; -webkit-appearance: none; appearance: none; height: 6px; background: #2C2C3A; border-radius: 3px; outline: none; }',
    '.esri-map-viz-timeline input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #00A4FD; cursor: pointer; }',
    '.esri-map-viz-timeline-time { display: flex; justify-content: space-between; font-size: 10px; color: #888; margin-top: 2px; }',
    '.esri-map-viz-timeline-btns { display: flex; gap: 4px; margin-top: 4px; }',
    '.esri-map-viz-timeline-btn { background: #2C2C3A; color: #C3CBD4; border: 1px solid #3C3C4A; border-radius: 3px; padding: 2px 8px; cursor: pointer; font-size: 10px; }',
    '.esri-map-viz-timeline-btn:hover { background: #3C3C4A; color: #FFF; }',
    '.esri-map-viz-timeline-btn.active { background: #00A4FD; color: #FFF; border-color: #00A4FD; }',
    '.esri-map-viz-spatial-results { position: absolute; top: 10px; right: 50px; z-index: 1100; background: rgba(26,26,46,0.95); border: 1px solid #2C2C3A; border-radius: 8px; padding: 10px 14px; color: #C3CBD4; font-size: 11px; max-width: 320px; max-height: 300px; overflow-y: auto; pointer-events: auto; box-shadow: 0 4px 16px rgba(0,0,0,0.4); }',
    '.esri-map-viz-spatial-results-title { font-weight: bold; font-size: 12px; margin-bottom: 6px; color: #F8FAFC; display: flex; justify-content: space-between; align-items: center; }',
    '.esri-map-viz-spatial-results-close { cursor: pointer; color: #888; font-size: 14px; }',
    '.esri-map-viz-spatial-results-close:hover { color: #FFF; }',
    '.esri-map-viz-spatial-result-item { padding: 6px 0; border-bottom: 1px solid #2C2C3A; cursor: pointer; }',
    '.esri-map-viz-spatial-result-item:last-child { border-bottom: none; }',
    '.esri-map-viz-spatial-result-item:hover { color: #00A4FD; }',
    '.esri-map-viz-spatial-result-item b { color: #00A4FD; }',
].join('\n');

function injectCSS() {
    if (document.getElementById('esri-map-viz-css')) return;

    var criticalStyle = document.createElement('style');
    criticalStyle.id = 'esri-map-viz-leaflet-critical';
    criticalStyle.textContent = LEAFLET_CRITICAL_CSS;
    document.head.appendChild(criticalStyle);

    if (leafletCSS && typeof leafletCSS === 'string' && leafletCSS.length > 100) {
        var baseStyle = document.createElement('style');
        baseStyle.id = 'esri-map-viz-leaflet-base';
        baseStyle.textContent = leafletCSS;
        document.head.appendChild(baseStyle);
    }

    if (markerClusterCSS && typeof markerClusterCSS === 'string') {
        var clusterStyle = document.createElement('style');
        clusterStyle.id = 'esri-map-viz-cluster-css';
        clusterStyle.textContent = markerClusterCSS;
        document.head.appendChild(clusterStyle);
    }
    if (markerClusterDefaultCSS && typeof markerClusterDefaultCSS === 'string') {
        var clusterDefaultStyle = document.createElement('style');
        clusterDefaultStyle.id = 'esri-map-viz-cluster-default-css';
        clusterDefaultStyle.textContent = markerClusterDefaultCSS;
        document.head.appendChild(clusterDefaultStyle);
    }

    var pluginCSSList = [geocoderCSS, drawCSS, minimapCSS];
    for (var pi = 0; pi < pluginCSSList.length; pi++) {
        if (pluginCSSList[pi] && typeof pluginCSSList[pi] === 'string') {
            var pluginEl = document.createElement('style');
            pluginEl.id = 'esri-map-viz-plugin-css-' + pi;
            pluginEl.textContent = pluginCSSList[pi];
            document.head.appendChild(pluginEl);
        }
    }

    var style = document.createElement('style');
    style.id = 'esri-map-viz-css';
    style.textContent = CUSTOM_CSS;
    document.head.appendChild(style);
}

// ── Custom Controls ───────────────────────────────────────────────

var FullscreenControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function(map) {
        var container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        var btn = L.DomUtil.create('a', 'esri-map-viz-fullscreen', container);
        btn.innerHTML = '\u26F6';
        btn.href = '#';
        btn.title = 'Toggle Fullscreen';
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(btn, 'click', function(e) {
            L.DomEvent.preventDefault(e);
            var el = map.getContainer().parentElement;
            if (!document.fullscreenElement) {
                if (el.requestFullscreen) el.requestFullscreen();
                else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
                btn.innerHTML = '\u2716';
            } else {
                if (document.exitFullscreen) document.exitFullscreen();
                else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
                btn.innerHTML = '\u26F6';
            }
        });
        return container;
    }
});

var CoordinateControl = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function(map) {
        this._div = L.DomUtil.create('div', 'esri-map-viz-coords');
        this._div.innerHTML = 'Lat: \u2014 Lon: \u2014';
        map.on('mousemove', this._onMouseMove, this);
        map.on('mouseout', this._onMouseOut, this);
        return this._div;
    },
    onRemove: function(map) {
        map.off('mousemove', this._onMouseMove, this);
        map.off('mouseout', this._onMouseOut, this);
    },
    _onMouseMove: function(e) {
        this._div.innerHTML = 'Lat: ' + e.latlng.lat.toFixed(5) + ' Lon: ' + e.latlng.lng.toFixed(5);
    },
    _onMouseOut: function() {
        this._div.innerHTML = 'Lat: \u2014 Lon: \u2014';
    }
});

var FeatureCountControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function() {
        this._div = L.DomUtil.create('div', 'esri-map-viz-badge');
        this._div.innerHTML = '0 features';
        return this._div;
    },
    update: function(count) {
        if (this._div) {
            this._div.innerHTML = count + (count === 1 ? ' feature' : ' features');
        }
    }
});

var LegendControl = L.Control.extend({
    options: { position: 'bottomright' },
    initialize: function(entries, opts) {
        L.Util.setOptions(this, opts);
        this._entries = entries || [];
    },
    onAdd: function() {
        var div = L.DomUtil.create('div', 'esri-map-viz-legend');
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        var title = L.DomUtil.create('div', 'esri-map-viz-legend-title', div);
        title.textContent = 'Legend';
        for (var i = 0; i < this._entries.length; i++) {
            var entry = this._entries[i];
            var item = L.DomUtil.create('div', 'esri-map-viz-legend-item', div);
            if (entry.icon && ICON_LIBRARY[entry.icon]) {
                var iconEl = L.DomUtil.create('span', 'esri-map-viz-legend-icon', item);
                iconEl.innerHTML = createSvgIconHtml(entry.icon, entry.color || '#00A4FD', 16);
            } else {
                var swatch = L.DomUtil.create('span', 'esri-map-viz-legend-swatch', item);
                swatch.style.backgroundColor = entry.color || '#00A4FD';
            }
            var label = L.DomUtil.create('span', 'esri-map-viz-legend-label', item);
            label.textContent = entry.label;
        }
        return div;
    }
});

var MeasureControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function(map) {
        this._map = map;
        this._active = false;
        this._points = [];
        this._polyline = null;
        this._markers = [];
        this._resultDiv = null;

        var container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        this._btn = L.DomUtil.create('a', 'esri-map-viz-measure-btn', container);
        this._btn.innerHTML = '\uD83D\uDCCF';
        this._btn.href = '#';
        this._btn.title = 'Measure Distance';
        L.DomEvent.disableClickPropagation(container);
        var self = this;
        L.DomEvent.on(this._btn, 'click', function(e) {
            L.DomEvent.preventDefault(e);
            if (self._active) { self._deactivate(); }
            else { self._activate(); }
        });
        return container;
    },
    _activate: function() {
        this._active = true;
        L.DomUtil.addClass(this._btn, 'active');
        this._map.getContainer().style.cursor = 'crosshair';
        this._points = [];
        this._clearGraphics();
        this._map.on('click', this._onMapClick, this);
        this._map.on('dblclick', this._onMapDblClick, this);
    },
    _deactivate: function() {
        this._active = false;
        L.DomUtil.removeClass(this._btn, 'active');
        this._map.getContainer().style.cursor = '';
        this._map.off('click', this._onMapClick, this);
        this._map.off('dblclick', this._onMapDblClick, this);
        this._clearGraphics();
    },
    _clearGraphics: function() {
        if (this._polyline) { this._map.removeLayer(this._polyline); this._polyline = null; }
        for (var i = 0; i < this._markers.length; i++) { this._map.removeLayer(this._markers[i]); }
        this._markers = [];
        if (this._resultDiv) { this._resultDiv.remove(); this._resultDiv = null; }
    },
    _onMapClick: function(e) {
        this._points.push(e.latlng);
        var m = L.circleMarker(e.latlng, { radius: 4, color: '#00A4FD', fillColor: '#00A4FD', fillOpacity: 1 });
        m.addTo(this._map);
        this._markers.push(m);
        if (this._points.length > 1) {
            if (this._polyline) this._map.removeLayer(this._polyline);
            this._polyline = L.polyline(this._points, { color: '#00A4FD', weight: 2, dashArray: '6,4' }).addTo(this._map);
            this._showResult();
        }
    },
    _onMapDblClick: function(e) {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
        this._map.off('click', this._onMapClick, this);
        this._map.off('dblclick', this._onMapDblClick, this);
        L.DomUtil.removeClass(this._btn, 'active');
        this._map.getContainer().style.cursor = '';
        this._active = false;
    },
    _showResult: function() {
        var total = 0;
        for (var i = 1; i < this._points.length; i++) {
            total += this._points[i - 1].distanceTo(this._points[i]);
        }
        if (this._resultDiv) this._resultDiv.remove();
        this._resultDiv = document.createElement('div');
        this._resultDiv.className = 'esri-map-viz-measure-result';
        this._resultDiv.innerHTML = '<b>Distance:</b> ' + formatDistance(total) +
            ' <span class="esri-map-viz-measure-close" title="Clear">\u2716</span>';
        this._map.getContainer().parentElement.appendChild(this._resultDiv);
        this._resultDiv.style.position = 'absolute';
        this._resultDiv.style.bottom = '30px';
        this._resultDiv.style.left = '50%';
        this._resultDiv.style.transform = 'translateX(-50%)';
        this._resultDiv.style.zIndex = '1100';
        var self = this;
        this._resultDiv.querySelector('.esri-map-viz-measure-close').addEventListener('click', function() {
            self._deactivate();
        });
    },
    onRemove: function() {
        this._deactivate();
    }
});

var TimelineControl = L.Control.extend({
    options: { position: 'bottomleft' },
    initialize: function(opts) {
        L.Util.setOptions(this, opts);
        this._minTime = 0;
        this._maxTime = 0;
        this._currentTime = 0;
        this._playing = false;
        this._interval = null;
        this._callback = null;
    },
    setTimeRange: function(min, max) {
        this._minTime = min;
        this._maxTime = max;
        this._currentTime = max;
        if (this._slider) {
            this._slider.min = min;
            this._slider.max = max;
            this._slider.value = max;
        }
        this._updateLabels();
    },
    setCallback: function(fn) { this._callback = fn; },
    onAdd: function() {
        var container = L.DomUtil.create('div', 'esri-map-viz-timeline');
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        var lbl = L.DomUtil.create('div', 'esri-map-viz-timeline-label', container);
        lbl.textContent = 'Timeline';

        this._slider = L.DomUtil.create('input', '', container);
        this._slider.type = 'range';
        this._slider.min = this._minTime;
        this._slider.max = this._maxTime;
        this._slider.value = this._maxTime;
        this._slider.step = 1;

        var timeRow = L.DomUtil.create('div', 'esri-map-viz-timeline-time', container);
        this._startLabel = L.DomUtil.create('span', '', timeRow);
        this._currentLabel = L.DomUtil.create('span', '', timeRow);
        this._endLabel = L.DomUtil.create('span', '', timeRow);

        var btns = L.DomUtil.create('div', 'esri-map-viz-timeline-btns', container);
        this._playBtn = L.DomUtil.create('button', 'esri-map-viz-timeline-btn', btns);
        this._playBtn.textContent = '\u25B6 Play';
        this._resetBtn = L.DomUtil.create('button', 'esri-map-viz-timeline-btn', btns);
        this._resetBtn.textContent = '\u21BA Reset';

        var self = this;
        L.DomEvent.on(this._slider, 'input', function() {
            self._currentTime = parseInt(self._slider.value, 10);
            self._updateLabels();
            if (self._callback) self._callback(self._currentTime);
        });
        L.DomEvent.on(this._playBtn, 'click', function() {
            if (self._playing) { self._stop(); }
            else { self._play(); }
        });
        L.DomEvent.on(this._resetBtn, 'click', function() {
            self._stop();
            self._currentTime = self._maxTime;
            self._slider.value = self._maxTime;
            self._updateLabels();
            if (self._callback) self._callback(self._currentTime);
        });

        this._updateLabels();
        return container;
    },
    _updateLabels: function() {
        if (!this._startLabel) return;
        this._startLabel.textContent = this._formatTime(this._minTime);
        this._currentLabel.textContent = this._formatTime(this._currentTime);
        this._endLabel.textContent = this._formatTime(this._maxTime);
    },
    _formatTime: function(epoch) {
        if (!epoch) return '--';
        var d = new Date(epoch * 1000);
        var mo = d.getMonth() + 1;
        var da = d.getDate();
        var h = d.getHours();
        var mi = d.getMinutes();
        return (mo < 10 ? '0' : '') + mo + '/' + (da < 10 ? '0' : '') + da +
            ' ' + (h < 10 ? '0' : '') + h + ':' + (mi < 10 ? '0' : '') + mi;
    },
    _play: function() {
        this._playing = true;
        L.DomUtil.addClass(this._playBtn, 'active');
        this._playBtn.textContent = '\u23F8 Pause';
        if (this._currentTime >= this._maxTime) {
            this._currentTime = this._minTime;
        }
        var self = this;
        var step = Math.max(1, Math.floor((this._maxTime - this._minTime) / 200));
        this._interval = setInterval(function() {
            self._currentTime += step;
            if (self._currentTime >= self._maxTime) {
                self._currentTime = self._maxTime;
                self._stop();
            }
            self._slider.value = self._currentTime;
            self._updateLabels();
            if (self._callback) self._callback(self._currentTime);
        }, 100);
    },
    _stop: function() {
        this._playing = false;
        L.DomUtil.removeClass(this._playBtn, 'active');
        this._playBtn.textContent = '\u25B6 Play';
        if (this._interval) { clearInterval(this._interval); this._interval = null; }
    },
    onRemove: function() {
        this._stop();
    }
});

// ── Visualization Class ──────────────────────────────────────────

module.exports = SplunkVisualizationBase.extend({

    initialize: function() {
        SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
        this.el.classList.add('esri-map-viz');

        injectCSS();

        this.el.style.position = 'relative';
        this.el.style.overflow = 'hidden';

        this.mapDiv = document.createElement('div');
        this.mapDiv.style.width = '100%';
        this.mapDiv.style.height = '100%';
        this.mapDiv.style.position = 'absolute';
        this.mapDiv.style.top = '0';
        this.mapDiv.style.left = '0';
        this.el.appendChild(this.mapDiv);

        this._map = null;
        this._basemapLayer = null;
        this._serviceLayer = null;
        this._searchResultsGroup = null;
        this._clusterGroup = null;
        this._heatLayer = null;
        this._scaleControl = null;
        this._zoomControl = null;
        this._fullscreenControl = null;
        this._coordControl = null;
        this._featureCountControl = null;
        this._legendControl = null;
        this._geocoderControl = null;
        this._drawControl = null;
        this._drawnItems = null;
        this._measureControl = null;
        this._minimapControl = null;
        this._timelineControl = null;
        this._sideBySideControl = null;
        this._secondaryBasemapLayer = null;

        this._currentBasemap = '';
        this._currentServiceUrl = '';
        this._currentServiceType = '';
        this._currentCustomTileUrl = '';
        this._hasUserInteracted = false;
        this._lastGoodData = null;
        this._mapInitialized = false;

        this._timelineCurrentTime = null;
        this._allFeatureData = null;
        this._spatialResultsDiv = null;
        this._spatialHighlightLayer = null;
    },

    _initMap: function(centerLat, centerLon, initialZoom, showZoomControl) {
        if (this._mapInitialized) return;

        var rect = this.el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            var self = this;
            setTimeout(function() { self.invalidateUpdateView(); }, 200);
            return;
        }

        this._map = L.map(this.mapDiv, {
            center: [centerLat, centerLon],
            zoom: initialZoom,
            zoomControl: false,
            attributionControl: true
        });

        if (showZoomControl) {
            this._zoomControl = L.control.zoom({ position: 'topright' });
            this._zoomControl.addTo(this._map);
        }

        this._searchResultsGroup = L.featureGroup().addTo(this._map);

        this._drawnItems = L.featureGroup().addTo(this._map);

        var self = this;
        this._map.on('moveend zoomend', function() {
            self._hasUserInteracted = true;
        });

        this._mapInitialized = true;

        setTimeout(function() { if (self._map) self._map.invalidateSize(); }, 100);
        setTimeout(function() { if (self._map) self._map.invalidateSize(); }, 500);
    },

    getInitialDataParams: function() {
        return {
            outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
            count: 10000
        };
    },

    formatData: function(data) {
        if (!data || !data.rows || data.rows.length === 0) {
            if (this._lastGoodData) return this._lastGoodData;
            return { colIdx: {}, rows: [], fieldNames: [] };
        }

        var fields = data.fields;
        var colIdx = {};
        var fieldNames = [];
        for (var i = 0; i < fields.length; i++) {
            colIdx[fields[i].name] = i;
            fieldNames.push(fields[i].name);
        }

        var result = { colIdx: colIdx, rows: data.rows, fieldNames: fieldNames };
        this._lastGoodData = result;
        return result;
    },

    updateView: function(data, config) {
        if (!data || !data.rows) {
            if (this._lastGoodData) { data = this._lastGoodData; }
            else { return; }
        }

        var ns = this.getPropertyNamespaceInfo().propertyNamespace;

        // ── Read all formatter settings ──
        var serviceUrl = getOption(config, ns, 'serviceUrl', '');
        var serviceType = getOption(config, ns, 'serviceType', 'feature');
        var basemap = getOption(config, ns, 'basemap', 'esri-dark-gray');
        var latField = getOption(config, ns, 'latField', 'latitude');
        var lonField = getOption(config, ns, 'lonField', 'longitude');
        var tooltipField = getOption(config, ns, 'tooltipField', 'description');
        var geojsonField = getOption(config, ns, 'geojsonField', 'geojson');
        var centerLat = parseFloat(getOption(config, ns, 'centerLat', '39.8'));
        var centerLon = parseFloat(getOption(config, ns, 'centerLon', '-98.5'));
        var initialZoom = parseInt(getOption(config, ns, 'initialZoom', '4'), 10);
        var maxZoom = parseInt(getOption(config, ns, 'maxZoom', '18'), 10);
        var minZoom = parseInt(getOption(config, ns, 'minZoom', '1'), 10);
        var showZoomControl = getOption(config, ns, 'showZoomControl', 'true') === 'true';
        var showScaleControl = getOption(config, ns, 'showScaleControl', 'false') === 'true';
        var autoFitBounds = getOption(config, ns, 'autoFitBounds', 'true') === 'true';
        var markerColor = getOption(config, ns, 'markerColor', '#00A4FD');
        var markerRadius = parseInt(getOption(config, ns, 'markerRadius', '6'), 10);
        var lineColor = getOption(config, ns, 'lineColor', '#00A4FD');
        var lineWidth = parseInt(getOption(config, ns, 'lineWidth', '2'), 10);
        var polygonFillColor = getOption(config, ns, 'polygonFillColor', '#00A4FD');
        var polygonStrokeColor = getOption(config, ns, 'polygonStrokeColor', '#FFFFFF');
        var polygonFillOpacity = parseFloat(getOption(config, ns, 'polygonFillOpacity', '0.3'));

        var serviceOpacity = parseFloat(getOption(config, ns, 'serviceOpacity', '1.0'));
        var enableClustering = getOption(config, ns, 'enableClustering', 'false') === 'true';
        var showLegend = getOption(config, ns, 'showLegend', 'true') === 'true';
        var showFullscreen = getOption(config, ns, 'showFullscreen', 'true') === 'true';
        var showCoordinates = getOption(config, ns, 'showCoordinates', 'false') === 'true';
        var showFeatureCount = getOption(config, ns, 'showFeatureCount', 'false') === 'true';
        var tooltipMode = getOption(config, ns, 'tooltipMode', 'click');
        var defaultIcon = getOption(config, ns, 'defaultIcon', 'none');
        var iconSize = parseInt(getOption(config, ns, 'iconSize', '24'), 10);
        var customTileUrl = getOption(config, ns, 'customTileUrl', '');
        var whereClause = getOption(config, ns, 'whereClause', '');
        var drilldownAction = getOption(config, ns, 'drilldownAction', 'none');

        // Phase 1-3 new settings
        var displayMode = getOption(config, ns, 'displayMode', 'markers');
        var heatmapRadius = parseInt(getOption(config, ns, 'heatmapRadius', '25'), 10);
        var heatmapBlur = parseInt(getOption(config, ns, 'heatmapBlur', '15'), 10);
        var heatmapMaxIntensity = parseFloat(getOption(config, ns, 'heatmapMaxIntensity', '0'));
        var showGeosearch = getOption(config, ns, 'showGeosearch', 'false') === 'true';
        var geocoderProviderType = getOption(config, ns, 'geocoderProvider', 'esri');
        var esriApiKey = getOption(config, ns, 'esriApiKey', '');
        var showDrawTools = getOption(config, ns, 'showDrawTools', 'false') === 'true';
        var showMeasure = getOption(config, ns, 'showMeasure', 'false') === 'true';
        var showMinimap = getOption(config, ns, 'showMinimap', 'false') === 'true';
        var showTimeline = getOption(config, ns, 'showTimeline', 'false') === 'true';
        var timeField = getOption(config, ns, 'timeField', '_time');
        var useServiceRenderer = getOption(config, ns, 'useServiceRenderer', 'false') === 'true';
        var clusterServiceFeatures = getOption(config, ns, 'clusterServiceFeatures', 'false') === 'true';
        var secondaryBasemap = getOption(config, ns, 'secondaryBasemap', 'none');
        var enableServicePopups = getOption(config, ns, 'enableServicePopups', 'true') === 'true';
        var enableSpatialQuery = getOption(config, ns, 'enableSpatialQuery', 'false') === 'true';

        if (isNaN(centerLat)) centerLat = 39.8;
        if (isNaN(centerLon)) centerLon = -98.5;
        if (isNaN(initialZoom)) initialZoom = 4;
        if (isNaN(maxZoom)) maxZoom = 18;
        if (isNaN(minZoom)) minZoom = 1;
        if (isNaN(markerRadius)) markerRadius = 6;
        if (isNaN(lineWidth)) lineWidth = 2;
        if (isNaN(polygonFillOpacity)) polygonFillOpacity = 0.3;
        if (isNaN(serviceOpacity)) serviceOpacity = 1.0;
        if (isNaN(iconSize)) iconSize = 24;
        if (isNaN(heatmapRadius)) heatmapRadius = 25;
        if (isNaN(heatmapBlur)) heatmapBlur = 15;
        if (isNaN(heatmapMaxIntensity)) heatmapMaxIntensity = 0;

        this._initMap(centerLat, centerLon, initialZoom, showZoomControl);
        if (!this._map) return;

        this._map.invalidateSize();
        this._map.setMinZoom(minZoom);
        this._map.setMaxZoom(maxZoom);

        // ── Zoom control toggle ──
        if (showZoomControl && !this._zoomControl) {
            this._zoomControl = L.control.zoom({ position: 'topright' });
            this._zoomControl.addTo(this._map);
        } else if (!showZoomControl && this._zoomControl) {
            this._map.removeControl(this._zoomControl);
            this._zoomControl = null;
        }

        // ── Scale control toggle ──
        if (showScaleControl && !this._scaleControl) {
            this._scaleControl = L.control.scale({ position: 'bottomleft', imperial: true, metric: true });
            this._scaleControl.addTo(this._map);
        } else if (!showScaleControl && this._scaleControl) {
            this._map.removeControl(this._scaleControl);
            this._scaleControl = null;
        }

        // ── Fullscreen control ──
        if (showFullscreen && !this._fullscreenControl) {
            this._fullscreenControl = new FullscreenControl();
            this._fullscreenControl.addTo(this._map);
        } else if (!showFullscreen && this._fullscreenControl) {
            this._map.removeControl(this._fullscreenControl);
            this._fullscreenControl = null;
        }

        // ── Coordinate display ──
        if (showCoordinates && !this._coordControl) {
            this._coordControl = new CoordinateControl();
            this._coordControl.addTo(this._map);
        } else if (!showCoordinates && this._coordControl) {
            this._map.removeControl(this._coordControl);
            this._coordControl = null;
        }

        // ── Feature count badge ──
        if (showFeatureCount && !this._featureCountControl) {
            this._featureCountControl = new FeatureCountControl();
            this._featureCountControl.addTo(this._map);
        } else if (!showFeatureCount && this._featureCountControl) {
            this._map.removeControl(this._featureCountControl);
            this._featureCountControl = null;
        }

        // ── Geocoder control ──
        if (showGeosearch && !this._geocoderControl) {
            try {
                var providerOpts = {};
                if (esriApiKey) providerOpts.apikey = esriApiKey;
                var geocoderProvider = EsriLeafletGeocode.arcgisOnlineProvider(providerOpts);

                var geocoderOpts = {
                    position: 'topleft',
                    placeholder: 'Search for places...',
                    collapseAfterResult: true,
                    expanded: false,
                    useMapBounds: false,
                    providers: [geocoderProvider]
                };
                this._geocoderControl = EsriLeafletGeocode.geosearch(geocoderOpts);
                this._geocoderControl.addTo(this._map);

                var geoMap = this._map;
                this._geocoderControl.on('results', function(data) {
                    if (data && data.results && data.results.length > 0) {
                        geoMap.setView(data.results[0].latlng, 14);
                    }
                });
            } catch (e) {
                console.warn('[ESRI Map Viz] Geocoder init failed:', e.message);
            }
        } else if (!showGeosearch && this._geocoderControl) {
            this._map.removeControl(this._geocoderControl);
            this._geocoderControl = null;
        }

        // ── Draw controls ──
        if (showDrawTools && !this._drawControl) {
            this._drawControl = new L.Control.Draw({
                position: 'topright',
                edit: { featureGroup: this._drawnItems },
                draw: {
                    polyline: { shapeOptions: { color: '#00A4FD', weight: 2 } },
                    polygon: { shapeOptions: { color: '#00A4FD', fillColor: '#00A4FD', fillOpacity: 0.2 } },
                    rectangle: { shapeOptions: { color: '#00A4FD', fillColor: '#00A4FD', fillOpacity: 0.2 } },
                    circle: { shapeOptions: { color: '#00A4FD', fillColor: '#00A4FD', fillOpacity: 0.2 } },
                    marker: true,
                    circlemarker: false
                }
            });
            this._drawControl.addTo(this._map);
            var self = this;
            this._map.on(L.Draw.Event.CREATED, function(e) {
                self._drawnItems.addLayer(e.layer);

                if (drilldownAction !== 'none' && e.layer.toGeoJSON) {
                    var gj = e.layer.toGeoJSON();
                    self.drilldown({
                        action: SplunkVisualizationBase.FIELD_VALUE_DRILLDOWN,
                        data: { 'drawn_geojson': JSON.stringify(gj.geometry), 'drawn_type': e.layerType }
                    });
                }

                // Feature 3: Spatial query against service FeatureLayer
                if (enableSpatialQuery && self._serviceLayer && serviceType === 'feature' && serviceUrl) {
                    self._runSpatialQuery(e.layer, serviceUrl);
                }
            });
        } else if (!showDrawTools && this._drawControl) {
            this._map.removeControl(this._drawControl);
            this._drawControl = null;
        }

        // ── Measure control ──
        if (showMeasure && !this._measureControl) {
            this._measureControl = new MeasureControl();
            this._measureControl.addTo(this._map);
        } else if (!showMeasure && this._measureControl) {
            this._map.removeControl(this._measureControl);
            this._measureControl = null;
        }

        // ── Minimap control ──
        if (showMinimap && !this._minimapControl) {
            var minimapTileUrl = BASEMAPS[basemap] ? BASEMAPS[basemap].url : BASEMAPS['esri-dark-gray'].url;
            var minimapLayer = L.tileLayer(minimapTileUrl, { maxZoom: 18 });
            this._minimapControl = new L.Control.MiniMap(minimapLayer, {
                toggleDisplay: true,
                minimized: false,
                position: 'bottomright',
                width: 120,
                height: 120,
                zoomLevelOffset: -4
            });
            this._minimapControl.addTo(this._map);
        } else if (!showMinimap && this._minimapControl) {
            this._map.removeControl(this._minimapControl);
            this._minimapControl = null;
        }

        // ── Update basemap ──
        var effectiveBasemap = customTileUrl ? '__custom__' : basemap;
        if (effectiveBasemap !== this._currentBasemap || customTileUrl !== this._currentCustomTileUrl) {
            this._currentBasemap = effectiveBasemap;
            this._currentCustomTileUrl = customTileUrl;
            if (this._basemapLayer) {
                this._map.removeLayer(this._basemapLayer);
                this._basemapLayer = null;
            }
            if (customTileUrl) {
                this._basemapLayer = L.tileLayer(customTileUrl, {
                    attribution: 'Custom tiles',
                    maxZoom: maxZoom
                }).addTo(this._map);
            } else if (basemap !== 'none' && BASEMAPS[basemap]) {
                var bm = BASEMAPS[basemap];
                this._basemapLayer = L.tileLayer(bm.url, {
                    attribution: bm.attribution,
                    maxZoom: bm.maxZoom || maxZoom
                }).addTo(this._map);
            }
            if (this._basemapLayer) {
                this._basemapLayer.on('tileerror', function(e) {
                    console.warn('[ESRI Map Viz] Tile load error:', e.tile ? e.tile.src : 'unknown', e.error);
                });
            }
        }

        // ── Side-by-Side compare ──
        if (this._sideBySideControl) {
            this._sideBySideControl.remove();
            this._sideBySideControl = null;
        }
        if (this._secondaryBasemapLayer) {
            this._map.removeLayer(this._secondaryBasemapLayer);
            this._secondaryBasemapLayer = null;
        }
        if (secondaryBasemap && secondaryBasemap !== 'none' && BASEMAPS[secondaryBasemap] && this._basemapLayer) {
            var sbm = BASEMAPS[secondaryBasemap];
            this._secondaryBasemapLayer = L.tileLayer(sbm.url, {
                attribution: sbm.attribution,
                maxZoom: sbm.maxZoom || maxZoom
            }).addTo(this._map);
            try {
                this._sideBySideControl = L.control.sideBySide(this._basemapLayer, this._secondaryBasemapLayer);
                this._sideBySideControl.addTo(this._map);
            } catch (e) {
                console.warn('[ESRI Map Viz] Side-by-side init failed:', e.message);
            }
        }

        // ── Update ESRI service layer ──
        if (serviceUrl !== this._currentServiceUrl || serviceType !== this._currentServiceType) {
            this._currentServiceUrl = serviceUrl;
            this._currentServiceType = serviceType;

            if (this._serviceLayer) {
                this._map.removeLayer(this._serviceLayer);
                this._serviceLayer = null;
            }

            if (serviceUrl) {
                try {
                    if (serviceType === 'tile') {
                        this._serviceLayer = EsriLeaflet.tiledMapLayer({ url: serviceUrl });
                    } else if (serviceType === 'dynamic') {
                        this._serviceLayer = EsriLeaflet.dynamicMapLayer({
                            url: serviceUrl, f: 'image', format: 'png32', transparent: true, opacity: serviceOpacity
                        });
                    } else if (serviceType === 'feature') {
                        var featureOpts = { url: serviceUrl };
                        if (whereClause) featureOpts.where = whereClause;
                        if (clusterServiceFeatures && EsriLeafletCluster) {
                            this._serviceLayer = EsriLeafletCluster.featureLayer(featureOpts);
                        } else {
                            this._serviceLayer = EsriLeaflet.featureLayer(featureOpts);
                        }
                    } else if (serviceType === 'image') {
                        this._serviceLayer = EsriLeaflet.imageMapLayer({
                            url: serviceUrl, f: 'image', format: 'png32', transparent: true
                        });
                    }
                } catch (e) {
                    console.warn('[ESRI Map Viz] Failed to create service layer:', e.message);
                }

                if (this._serviceLayer) {
                    if (typeof this._serviceLayer.setOpacity === 'function') {
                        this._serviceLayer.setOpacity(serviceOpacity);
                    }
                    this._serviceLayer.addTo(this._map);
                    this._serviceLayer.on('error', function(e) {
                        console.warn('[ESRI Map Viz] Service layer error:', e.error || e);
                    });

                    // Feature 1: Click-to-Identify on non-feature service layers
                    if (enableServicePopups && (serviceType === 'dynamic' || serviceType === 'image')) {
                        var identifyLayer = this._serviceLayer;
                        var identifyMap = this._map;
                        this._serviceLayer.on('click', function(e) {
                            if (typeof identifyLayer.identify !== 'function') return;
                            identifyLayer.identify()
                                .at(e.latlng)
                                .tolerance(5)
                                .on(identifyMap)
                                .run(function(error, featureCollection) {
                                    if (error) {
                                        console.warn('[ESRI Map Viz] Identify error:', error);
                                        return;
                                    }
                                    if (!featureCollection || !featureCollection.features || featureCollection.features.length === 0) return;
                                    var popupParts = [];
                                    for (var fi = 0; fi < featureCollection.features.length; fi++) {
                                        var feat = featureCollection.features[fi];
                                        var layerName = (feat.layerName || feat.id || ('Feature ' + (fi + 1)));
                                        var html = buildServicePopupHTML(feat.properties);
                                        if (html) {
                                            popupParts.push('<div style="margin-bottom:8px"><div style="color:#00A4FD;font-weight:bold;margin-bottom:2px">' + escapePopup(String(layerName)) + '</div>' + html + '</div>');
                                        }
                                    }
                                    if (popupParts.length > 0) {
                                        L.popup({ maxWidth: 350, maxHeight: 300 })
                                            .setLatLng(e.latlng)
                                            .setContent('<div style="max-height:280px;overflow-y:auto">' + popupParts.join('<hr style="border-color:#2C2C3A;margin:4px 0">') + '</div>')
                                            .openOn(identifyMap);
                                    }
                                });
                        });
                    }

                    // Feature 1b: Click-to-Identify on tiled map layers (no native click, use map click)
                    if (enableServicePopups && serviceType === 'tile') {
                        var tiledLayer = this._serviceLayer;
                        var tiledMap = this._map;
                        this._map.on('click', function(e) {
                            if (!tiledLayer || typeof tiledLayer.identify !== 'function') return;
                            tiledLayer.identify()
                                .at(e.latlng)
                                .tolerance(5)
                                .on(tiledMap)
                                .run(function(error, featureCollection) {
                                    if (error) return;
                                    if (!featureCollection || !featureCollection.features || featureCollection.features.length === 0) return;
                                    var popupParts = [];
                                    for (var fi = 0; fi < featureCollection.features.length; fi++) {
                                        var feat = featureCollection.features[fi];
                                        var layerName = (feat.layerName || feat.id || ('Feature ' + (fi + 1)));
                                        var html = buildServicePopupHTML(feat.properties);
                                        if (html) {
                                            popupParts.push('<div style="margin-bottom:8px"><div style="color:#00A4FD;font-weight:bold;margin-bottom:2px">' + escapePopup(String(layerName)) + '</div>' + html + '</div>');
                                        }
                                    }
                                    if (popupParts.length > 0) {
                                        L.popup({ maxWidth: 350, maxHeight: 300 })
                                            .setLatLng(e.latlng)
                                            .setContent('<div style="max-height:280px;overflow-y:auto">' + popupParts.join('<hr style="border-color:#2C2C3A;margin:4px 0">') + '</div>')
                                            .openOn(tiledMap);
                                    }
                                });
                        });
                    }

                    // Feature 2: Bind popups on FeatureLayer with service-defined attributes
                    if (enableServicePopups && serviceType === 'feature') {
                        this._serviceLayer.bindPopup(function(layer) {
                            var props = layer.feature ? layer.feature.properties : null;
                            var html = buildServicePopupHTML(props);
                            return html || '<em>No attributes available</em>';
                        }, { maxWidth: 350, maxHeight: 300 });
                    }
                }
            }
        } else if (this._serviceLayer && typeof this._serviceLayer.setOpacity === 'function') {
            this._serviceLayer.setOpacity(serviceOpacity);
        }

        // ── Clear previous layers ──
        this._searchResultsGroup.clearLayers();
        if (this._clusterGroup) {
            this._map.removeLayer(this._clusterGroup);
            this._clusterGroup = null;
        }
        if (this._heatLayer) {
            this._map.removeLayer(this._heatLayer);
            this._heatLayer = null;
        }

        if (enableClustering && (displayMode === 'markers' || displayMode === 'both')) {
            this._clusterGroup = L.markerClusterGroup({
                maxClusterRadius: 50,
                spiderfyOnMaxZoom: true,
                showCoverageOnHover: false,
                zoomToBoundsOnClick: true
            });
        }

        var colIdx = data.colIdx;
        var rows = data.rows;
        var fieldNames = data.fieldNames;
        var hasLatLon = colIdx[latField] !== undefined && colIdx[lonField] !== undefined;
        var hasGeoJSON = colIdx[geojsonField] !== undefined;
        var hasTooltip = colIdx[tooltipField] !== undefined;
        var hasColor = colIdx['_color'] !== undefined;
        var hasRadius = colIdx['_radius'] !== undefined;
        var hasWeight = colIdx['_weight'] !== undefined;
        var hasIcon = colIdx['_icon'] !== undefined;
        var hasIconUrl = colIdx['_iconUrl'] !== undefined;
        var hasLabel = colIdx['_label'] !== undefined;
        var hasLegend = colIdx['_legend'] !== undefined;
        var hasIntensity = colIdx['_intensity'] !== undefined;
        var hasTime = colIdx[timeField] !== undefined;
        var boundsPoints = [];
        var featureCount = 0;
        var heatPoints = [];

        var legendMap = {};
        var legendOrder = [];

        var timeValues = [];
        var self = this;

        // Pre-scan: collect ALL time values before filtering so the timeline
        // range always reflects the full dataset, not just visible rows.
        if (hasTime) {
            for (var ti = 0; ti < rows.length; ti++) {
                var tvRaw = rows[ti][colIdx[timeField]];
                if (tvRaw) {
                    var tv = parseFloat(tvRaw);
                    if (!isNaN(tv)) timeValues.push(tv);
                }
            }
        }

        for (var ri = 0; ri < rows.length; ri++) {
            var row = rows[ri];
            var rowColor = hasColor ? (row[colIdx['_color']] || markerColor) : markerColor;
            var rowIconName = hasIcon ? row[colIdx['_icon']] : null;
            var rowIconUrl = hasIconUrl ? row[colIdx['_iconUrl']] : null;
            var rowLabel = hasLabel ? row[colIdx['_label']] : null;
            var rowLegend = hasLegend ? row[colIdx['_legend']] : null;
            var rowTime = hasTime ? row[colIdx[timeField]] : null;

            if (rowLegend && !legendMap[rowLegend]) {
                legendMap[rowLegend] = { label: rowLegend, color: rowColor, icon: rowIconName || (defaultIcon !== 'none' ? defaultIcon : null) };
                legendOrder.push(rowLegend);
            }

            // Timeline filtering
            if (showTimeline && hasTime && rowTime && this._timelineCurrentTime !== null) {
                var rowEpoch = parseFloat(rowTime);
                if (!isNaN(rowEpoch) && rowEpoch > this._timelineCurrentTime) {
                    continue;
                }
            }

            // GeoJSON geometry
            if (hasGeoJSON) {
                var gjStr = row[colIdx[geojsonField]];
                var gj = parseGeoJSON(gjStr);
                if (gj) {
                    var rowWeight = hasWeight ? parseInt(row[colIdx['_weight']], 10) : lineWidth;
                    if (isNaN(rowWeight)) rowWeight = lineWidth;

                    var useIcon = rowIconName || (defaultIcon !== 'none' ? defaultIcon : null);
                    var useIconUrl = rowIconUrl || null;

                    var gjLayer = L.geoJSON(gj, {
                        style: function(feature) {
                            var gt = feature.geometry ? feature.geometry.type : '';
                            var isLine = gt === 'LineString' || gt === 'MultiLineString';
                            return {
                                color: rowColor || (isLine ? lineColor : polygonStrokeColor),
                                fillColor: rowColor || polygonFillColor,
                                fillOpacity: isLine ? 0 : polygonFillOpacity,
                                weight: rowWeight,
                                opacity: 0.9
                            };
                        },
                        pointToLayer: function(feature, latlng) {
                            if (useIconUrl) {
                                return L.marker(latlng, { icon: L.icon({ iconUrl: useIconUrl, iconSize: [iconSize, iconSize], iconAnchor: [iconSize / 2, iconSize / 2], className: 'esri-map-viz-icon' }) });
                            }
                            if (useIcon && ICON_LIBRARY[useIcon]) {
                                return L.marker(latlng, { icon: L.divIcon({ html: createSvgIconHtml(useIcon, rowColor, iconSize), className: 'esri-map-viz-icon', iconSize: [iconSize, iconSize], iconAnchor: [iconSize / 2, iconSize / 2] }) });
                            }
                            var ptRadius = hasRadius ? (parseInt(row[colIdx['_radius']], 10) || markerRadius) : markerRadius;
                            return L.circleMarker(latlng, { radius: ptRadius, fillColor: rowColor, color: rowColor, weight: 1, fillOpacity: 0.8 });
                        }
                    });

                    var popupHTML = '';
                    if (hasTooltip && row[colIdx[tooltipField]]) {
                        popupHTML = escapePopup(row[colIdx[tooltipField]]);
                    } else {
                        popupHTML = buildPopupHTML(row, colIdx, fieldNames);
                    }

                    if (popupHTML) {
                        if (tooltipMode === 'hover' || tooltipMode === 'both') {
                            gjLayer.bindTooltip(popupHTML, { sticky: true });
                        }
                        if (tooltipMode === 'click' || tooltipMode === 'both') {
                            gjLayer.bindPopup(popupHTML);
                        }
                    }

                    if (drilldownAction !== 'none') {
                        (function(rowData) {
                            gjLayer.on('click', function() {
                                self._doDrilldown(rowData, colIdx, fieldNames, drilldownAction);
                            });
                        })(row);
                    }

                    this._searchResultsGroup.addLayer(gjLayer);
                    featureCount++;

                    try {
                        var gjBounds = gjLayer.getBounds();
                        if (gjBounds && gjBounds.isValid()) {
                            boundsPoints.push(gjBounds.getSouthWest());
                            boundsPoints.push(gjBounds.getNorthEast());
                        }
                    } catch (e) { /* ignore */ }

                    continue;
                }
            }

            // Point from lat/lon
            if (hasLatLon) {
                var lat = parseFloat(row[colIdx[latField]]);
                var lon = parseFloat(row[colIdx[lonField]]);

                if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
                    // Collect heat points
                    if (displayMode === 'heatmap' || displayMode === 'both') {
                        var intensity = hasIntensity ? (parseFloat(row[colIdx['_intensity']]) || 1) : 1;
                        heatPoints.push([lat, lon, intensity]);
                    }

                    // Create markers if mode includes markers
                    if (displayMode === 'markers' || displayMode === 'both') {
                        var ptColor = rowColor;
                        var ptRad = hasRadius ? (parseInt(row[colIdx['_radius']], 10) || markerRadius) : markerRadius;
                        var iconName = rowIconName || (defaultIcon !== 'none' ? defaultIcon : null);
                        var marker;

                        if (rowIconUrl) {
                            marker = L.marker([lat, lon], {
                                icon: L.icon({ iconUrl: rowIconUrl, iconSize: [iconSize, iconSize], iconAnchor: [iconSize / 2, iconSize / 2], className: 'esri-map-viz-icon' })
                            });
                        } else if (iconName && ICON_LIBRARY[iconName]) {
                            marker = L.marker([lat, lon], {
                                icon: L.divIcon({
                                    html: createSvgIconHtml(iconName, ptColor, iconSize),
                                    className: 'esri-map-viz-icon',
                                    iconSize: [iconSize, iconSize],
                                    iconAnchor: [iconSize / 2, iconSize / 2]
                                })
                            });
                        } else {
                            marker = L.circleMarker([lat, lon], {
                                radius: ptRad, fillColor: ptColor, color: ptColor, weight: 1, fillOpacity: 0.8
                            });
                        }

                        var ptPopup = '';
                        if (hasTooltip && row[colIdx[tooltipField]]) {
                            ptPopup = escapePopup(row[colIdx[tooltipField]]);
                        } else {
                            ptPopup = buildPopupHTML(row, colIdx, fieldNames);
                        }

                        if (ptPopup) {
                            if (tooltipMode === 'hover' || tooltipMode === 'both') {
                                marker.bindTooltip(ptPopup, { sticky: true });
                            }
                            if (tooltipMode === 'click' || tooltipMode === 'both') {
                                marker.bindPopup(ptPopup);
                            }
                        }

                        if (drilldownAction !== 'none') {
                            (function(rowData) {
                                marker.on('click', function() {
                                    self._doDrilldown(rowData, colIdx, fieldNames, drilldownAction);
                                });
                            })(row);
                        }

                        if (rowLabel) {
                            var labelIcon = L.divIcon({
                                html: '<div class="esri-map-viz-label">' + escapePopup(rowLabel) + '</div>',
                                className: '',
                                iconSize: [100, 14],
                                iconAnchor: [50, -8]
                            });
                            var labelMarker = L.marker([lat, lon], { icon: labelIcon, interactive: false });
                            this._searchResultsGroup.addLayer(labelMarker);
                        }

                        if (enableClustering && this._clusterGroup) {
                            this._clusterGroup.addLayer(marker);
                        } else {
                            this._searchResultsGroup.addLayer(marker);
                        }
                    }

                    featureCount++;
                    boundsPoints.push(L.latLng(lat, lon));
                }
            }
        }

        // ── Add cluster group ──
        if (enableClustering && this._clusterGroup) {
            this._map.addLayer(this._clusterGroup);
        }

        // ── Add heatmap layer ──
        if ((displayMode === 'heatmap' || displayMode === 'both') && heatPoints.length > 0) {
            var heatOpts = {
                radius: heatmapRadius,
                blur: heatmapBlur,
                maxZoom: maxZoom,
                minOpacity: 0.3
            };
            if (heatmapMaxIntensity > 0) heatOpts.max = heatmapMaxIntensity;
            this._heatLayer = L.heatLayer(heatPoints, heatOpts).addTo(this._map);
        }

        // ── Feature count badge ──
        if (this._featureCountControl) {
            this._featureCountControl.update(featureCount);
        }

        // ── Legend ──
        if (this._legendControl) {
            this._map.removeControl(this._legendControl);
            this._legendControl = null;
        }

        if (showLegend && legendOrder.length > 0) {
            var legendEntries = [];
            for (var li = 0; li < legendOrder.length; li++) {
                legendEntries.push(legendMap[legendOrder[li]]);
            }
            this._legendControl = new LegendControl(legendEntries);
            this._legendControl.addTo(this._map);
        }

        // ── Timeline control ──
        if (showTimeline && hasTime && timeValues.length > 0) {
            var tMin = Math.min.apply(null, timeValues);
            var tMax = Math.max.apply(null, timeValues);
            if (!this._timelineControl) {
                this._timelineControl = new TimelineControl();
                this._timelineControl.addTo(this._map);
                var vizSelf = this;
                this._timelineControl.setCallback(function(t) {
                    vizSelf._timelineCurrentTime = t;
                    vizSelf.invalidateUpdateView();
                });
            }
            this._timelineControl.setTimeRange(tMin, tMax);
            if (this._timelineCurrentTime === null) {
                this._timelineCurrentTime = tMax;
            }
        } else if (!showTimeline && this._timelineControl) {
            this._map.removeControl(this._timelineControl);
            this._timelineControl = null;
            this._timelineCurrentTime = null;
        }

        // ── Auto-fit bounds ──
        if (autoFitBounds && boundsPoints.length > 0 && !this._hasUserInteracted) {
            try {
                var fitBounds = L.latLngBounds(boundsPoints);
                if (fitBounds.isValid()) {
                    this._map.fitBounds(fitBounds.pad(0.1), { maxZoom: maxZoom });
                }
            } catch (e) {
                this._map.setView([centerLat, centerLon], initialZoom);
            }
        } else if (boundsPoints.length === 0 && !this._hasUserInteracted && !serviceUrl) {
            this._map.setView([centerLat, centerLon], initialZoom);
        }

        this._hasUserInteracted = false;
    },

    _runSpatialQuery: function(drawnLayer, featureUrl) {
        var self = this;
        var map = this._map;

        if (this._spatialHighlightLayer) {
            map.removeLayer(this._spatialHighlightLayer);
            this._spatialHighlightLayer = null;
        }

        try {
            var query = EsriLeaflet.query({ url: featureUrl });

            if (drawnLayer instanceof L.Circle) {
                var center = drawnLayer.getLatLng();
                var radius = drawnLayer.getRadius();
                query = query.nearby(center, Math.round(radius));
            } else if (typeof drawnLayer.toGeoJSON === 'function') {
                var gj = drawnLayer.toGeoJSON();
                query = query.intersects(gj);
            } else {
                return;
            }

            query.run(function(error, featureCollection) {
                if (error) {
                    console.warn('[ESRI Map Viz] Spatial query error:', error);
                    return;
                }
                if (!featureCollection || !featureCollection.features) return;

                self._spatialHighlightLayer = L.geoJSON(featureCollection, {
                    style: function() {
                        return { color: '#FFB300', fillColor: '#FFB300', fillOpacity: 0.3, weight: 2 };
                    },
                    pointToLayer: function(feature, latlng) {
                        return L.circleMarker(latlng, {
                            radius: 8, fillColor: '#FFB300', color: '#FFB300', weight: 2, fillOpacity: 0.6
                        });
                    },
                    onEachFeature: function(feature, layer) {
                        var html = buildServicePopupHTML(feature.properties);
                        if (html) layer.bindPopup(html, { maxWidth: 350, maxHeight: 300 });
                    }
                }).addTo(map);

                self._showSpatialResults(featureCollection.features);
            });
        } catch (e) {
            console.warn('[ESRI Map Viz] Spatial query failed:', e.message);
        }
    },

    _showSpatialResults: function(features) {
        if (this._spatialResultsDiv) {
            this._spatialResultsDiv.remove();
            this._spatialResultsDiv = null;
        }

        var container = this.el;
        var div = document.createElement('div');
        div.className = 'esri-map-viz-spatial-results';

        var titleRow = document.createElement('div');
        titleRow.className = 'esri-map-viz-spatial-results-title';
        titleRow.innerHTML = '<span>' + features.length + ' feature' + (features.length !== 1 ? 's' : '') + ' found</span>';

        var closeBtn = document.createElement('span');
        closeBtn.className = 'esri-map-viz-spatial-results-close';
        closeBtn.innerHTML = '\u2716';
        titleRow.appendChild(closeBtn);
        div.appendChild(titleRow);

        var self = this;
        var map = this._map;
        closeBtn.addEventListener('click', function() {
            div.remove();
            self._spatialResultsDiv = null;
            if (self._spatialHighlightLayer) {
                map.removeLayer(self._spatialHighlightLayer);
                self._spatialHighlightLayer = null;
            }
        });

        var maxShow = Math.min(features.length, 50);
        for (var i = 0; i < maxShow; i++) {
            var feat = features[i];
            var props = feat.properties || {};
            var displayName = '';
            var nameFields = ['NAME', 'Name', 'name', 'LABEL', 'Label', 'label', 'TITLE', 'Title', 'title', 'NAAM', 'Naam', 'DESCRIPTION', 'Description'];
            for (var nf = 0; nf < nameFields.length; nf++) {
                if (props[nameFields[nf]]) { displayName = String(props[nameFields[nf]]); break; }
            }
            if (!displayName) displayName = 'Feature ' + (i + 1);

            var itemDiv = document.createElement('div');
            itemDiv.className = 'esri-map-viz-spatial-result-item';
            itemDiv.innerHTML = '<b>' + escapePopup(displayName) + '</b>';
            itemDiv.setAttribute('data-idx', String(i));

            (function(feature) {
                itemDiv.addEventListener('click', function() {
                    if (!feature.geometry) return;
                    var geom = feature.geometry;
                    if (geom.type === 'Point' && geom.coordinates) {
                        map.setView([geom.coordinates[1], geom.coordinates[0]], 16);
                        var html = buildServicePopupHTML(feature.properties);
                        if (html) {
                            L.popup({ maxWidth: 350, maxHeight: 300 })
                                .setLatLng([geom.coordinates[1], geom.coordinates[0]])
                                .setContent(html)
                                .openOn(map);
                        }
                    } else {
                        try {
                            var tempLayer = L.geoJSON(feature);
                            var bounds = tempLayer.getBounds();
                            if (bounds && bounds.isValid()) map.fitBounds(bounds.pad(0.2));
                            tempLayer.remove();
                        } catch (e) { /* ignore */ }
                    }
                });
            })(feat);

            div.appendChild(itemDiv);
        }

        if (features.length > maxShow) {
            var moreDiv = document.createElement('div');
            moreDiv.style.cssText = 'color:#888;font-style:italic;padding:4px 0';
            moreDiv.textContent = '... and ' + (features.length - maxShow) + ' more';
            div.appendChild(moreDiv);
        }

        container.appendChild(div);
        this._spatialResultsDiv = div;
    },

    _doDrilldown: function(row, colIdx, fieldNames, action) {
        var payload = {};
        for (var i = 0; i < fieldNames.length; i++) {
            var fn = fieldNames[i];
            var idx = colIdx[fn];
            if (idx !== undefined && row[idx] !== null && row[idx] !== undefined) {
                payload[fn] = row[idx];
            }
        }
        if (action === 'all') {
            this.drilldown({ action: SplunkVisualizationBase.FIELD_VALUE_DRILLDOWN, data: payload });
        }
    },

    reflow: function() {
        if (this._map) {
            this._map.invalidateSize();
            var self = this;
            setTimeout(function() { if (self._map) self._map.invalidateSize(); }, 100);
        }
    },

    destroy: function() {
        if (this._spatialResultsDiv) {
            this._spatialResultsDiv.remove();
            this._spatialResultsDiv = null;
        }
        if (this._spatialHighlightLayer && this._map) {
            this._map.removeLayer(this._spatialHighlightLayer);
            this._spatialHighlightLayer = null;
        }
        if (this._map) {
            this._map.remove();
            this._map = null;
        }
        this._mapInitialized = false;
        SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
    }
});
