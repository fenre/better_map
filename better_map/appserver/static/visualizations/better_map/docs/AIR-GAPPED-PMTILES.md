# Air-gapped PMTiles basemap — operator guide

> Audience: Splunk admins running Better Map v1.6 in environments where the
> dashboard cannot reach external tile providers (carto.com, openstreetmap.org,
> mapbox.com).

PMTiles is a single-file vector basemap format. The whole world basemap fits
in roughly 70 MB. The Better Map viz reads it via the `pmtiles://` protocol
and renders it inside MapLibre — no external HTTP, no tile server, no key.

## At a glance

| Step | Where | What |
|---|---|---|
| 1 | Build host (internet) | Run `scripts/build-pmtiles.sh` to create `basemap.pmtiles` |
| 2 | Splunk Enterprise host | Copy `basemap.pmtiles` into `$SPLUNK_HOME/etc/apps/better_map/appserver/static/` |
| 3 | Dashboard JSON | Set `basemapId: 'pmtiles'` and `basemapPMTilesUrl` to the static URL |
| 4 | Validate | Open dashboard; map renders without internet egress |

## Prerequisites (build host only)

You need a machine with internet access to build the archive. The output is
self-contained and can be transferred to the air-gapped network however you
move files today (USB, signed RPM, scanned upload).

| Tool | Install (macOS) | Install (Linux) |
|---|---|---|
| `tippecanoe` | `brew install tippecanoe` | `apt install tippecanoe` |
| `pmtiles` CLI | `go install github.com/protomaps/go-pmtiles/cmd/pmtiles@latest` | same |
| `curl` | preinstalled | preinstalled |

## Step 1 — Get source data

Use **Natural Earth** for low-zoom (continent / country) basemaps. It's
public-domain so it can be redistributed without attribution headaches:

```bash
curl -L -o ne_countries.geojson \
  https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.geojson
```

For city-scale detail, use a **Protomaps daily extract** from
https://maps.protomaps.com/ — pick the smallest bbox that covers your area
of interest to keep the file size down.

## Step 2 — Build the archive

```bash
cd better_map/appserver/static/visualizations/better_map
./scripts/build-pmtiles.sh \
    -o basemap.pmtiles \
    -s ne_countries.geojson \
    --minzoom 0 --maxzoom 6 \
    --layer basemap \
    --name "Better Map air-gapped basemap"
```

Expected output: a `basemap.pmtiles` file of roughly **5–80 MB** depending
on `--maxzoom`.

Sanity-check the archive locally before shipping it:

```bash
pmtiles show basemap.pmtiles
pmtiles serve --port 8081 basemap.pmtiles
# then visit http://localhost:8081 in a browser
```

## Step 3 — Deploy to Splunk

Copy the archive into the app's static directory:

```bash
cp basemap.pmtiles \
   $SPLUNK_HOME/etc/apps/better_map/appserver/static/basemap.pmtiles
```

Restart the Splunk web tier so the new static asset is picked up:

```bash
$SPLUNK_HOME/bin/splunk restart splunkweb
```

The file is now served at:

```
https://<splunk-host>:8000/en-US/static/app/better_map/basemap.pmtiles
```

(or under whichever locale + port your Splunk Web is configured with).

## Step 4 — Dashboard configuration

In your Dashboard Studio JSON, set the Better Map viz options to:

```json
{
  "type": "better_map.better_map",
  "options": {
    "basemapId": "pmtiles",
    "basemapPMTilesUrl": "/en-US/static/app/better_map/basemap.pmtiles",
    "basemapPMTilesStyle": "dark"
  }
}
```

| Option | Type | Notes |
|---|---|---|
| `basemapId` | string | Set to `"pmtiles"` to enable this loader |
| `basemapPMTilesUrl` | string | Absolute or relative URL to the .pmtiles file |
| `basemapPMTilesStyle` | string | `"dark"` (default) or `"light"` |
| `basemapPMTilesAttribution` | string | Override the on-map attribution string |

## CSP and TLS

The `pmtiles://` protocol resolves to plain HTTP/HTTPS range requests under
the hood. Make sure your Splunk Content-Security-Policy allows `connect-src`
to the same origin (the default Splunk CSP already does this). No external
domains are contacted.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Map background grey, tiles never load | URL typo in `basemapPMTilesUrl` | Open the URL directly in a browser; it should download the file |
| 404 on .pmtiles | File not in `appserver/static/` or Splunk not restarted | `cp` again, then `splunk restart splunkweb` |
| `Failed to fetch tile` console errors | Splunk CSP missing `connect-src 'self'` | Add it to `web.conf` `[settings]` |
| Build script fails on `tippecanoe` not found | Tool missing | Install per the prerequisites table |
| Archive > 200 MB | `--maxzoom` too high or bbox too large | Lower `--maxzoom` to 6 or 7 for global coverage; clip the source to a smaller bbox |

## What's NOT shipped

* The .pmtiles archive itself — see step 2; it's user-built so we can't ship
  a one-size-fits-all file under our license.
* Glyphs — if you want text labels rendered on the basemap, supply
  `glyphsUrl` in the basemap options. Protomaps publishes a glyphs bundle at
  https://github.com/protomaps/basemaps-assets that you can also host
  statically.

## Reference

* PMTiles spec: https://github.com/protomaps/PMTiles
* PMTiles npm client (the one we use): https://www.npmjs.com/package/pmtiles
* Protomaps basemaps: https://protomaps.com/
* Natural Earth data: https://www.naturalearthdata.com/
