#!/usr/bin/env python3
"""
Storm Surge Weather — Python Radar Microservice v14.0
Handles: NEXRAD Level II (AWS), Dual-Pol, Velocity, GOES satellite, Skew-T
"""

import os, io, json, math, datetime, tempfile, threading, time, logging
from pathlib import Path
from flask import Flask, jsonify, request, send_file, Response
from flask_cors import CORS

logging.basicConfig(level=logging.INFO)
log = logging.getLogger('radar_service')

app = Flask(__name__)
CORS(app)

# ── In-memory cache ──────────────────────────────────────────────
_cache = {}
def cache_get(key): 
    v = _cache.get(key)
    if v and v['exp'] > time.time(): return v['data']
    return None
def cache_set(key, data, ttl=300):
    _cache[key] = {'data': data, 'exp': time.time() + ttl}

# ── NEXRAD Level II via nexradaws + AWS S3 ───────────────────────
try:
    import nexradaws
    NEXRAD_OK = True
    log.info("nexradaws loaded OK")
except ImportError:
    NEXRAD_OK = False
    log.warning("nexradaws not available")

try:
    import pyart
    PYART_OK = True
    log.info("PyART loaded OK")
except ImportError:
    PYART_OK = False
    log.warning("PyART not available")

try:
    import numpy as np
    NUMPY_OK = True
except ImportError:
    NUMPY_OK = False


def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


# Hardcoded NEXRAD stations (160 WSR-88D sites)
NEXRAD_STATIONS = [
    {"id":"KABR","name":"Aberdeen SD","lat":45.456,"lng":-98.413},
    {"id":"KABX","name":"Albuquerque NM","lat":35.150,"lng":-106.824},
    {"id":"KAKQ","name":"Wakefield VA","lat":36.984,"lng":-77.008},
    {"id":"KALY","name":"Albany NY","lat":42.747,"lng":-73.838},
    {"id":"KAMX","name":"Miami FL","lat":25.611,"lng":-80.413},
    {"id":"KAPD","name":"Fairbanks AK","lat":64.808,"lng":-147.501},
    {"id":"KAPX","name":"Gaylord MI","lat":44.907,"lng":-84.720},
    {"id":"KARX","name":"La Crosse WI","lat":43.823,"lng":-91.191},
    {"id":"KATX","name":"Seattle WA","lat":48.195,"lng":-122.496},
    {"id":"KBBX","name":"Beale AFB CA","lat":39.496,"lng":-121.632},
    {"id":"KBGM","name":"Binghamton NY","lat":42.200,"lng":-75.985},
    {"id":"KBHX","name":"Eureka CA","lat":40.499,"lng":-124.292},
    {"id":"KBIS","name":"Bismarck ND","lat":46.771,"lng":-100.760},
    {"id":"KBLX","name":"Billings MT","lat":45.854,"lng":-108.607},
    {"id":"KBMX","name":"Birmingham AL","lat":33.172,"lng":-86.770},
    {"id":"KBOX","name":"Boston MA","lat":41.956,"lng":-71.137},
    {"id":"KBRO","name":"Brownsville TX","lat":25.916,"lng":-97.419},
    {"id":"KBUF","name":"Buffalo NY","lat":42.489,"lng":-78.737},
    {"id":"KBYX","name":"Key West FL","lat":24.598,"lng":-81.703},
    {"id":"KCAE","name":"Columbia SC","lat":33.949,"lng":-81.119},
    {"id":"KCBW","name":"Caribou ME","lat":46.039,"lng":-67.806},
    {"id":"KCBX","name":"Boise ID","lat":43.491,"lng":-116.236},
    {"id":"KCCX","name":"State College PA","lat":40.923,"lng":-78.004},
    {"id":"KCLE","name":"Cleveland OH","lat":41.413,"lng":-81.860},
    {"id":"KCLX","name":"Charleston SC","lat":32.656,"lng":-81.042},
    {"id":"KCRP","name":"Corpus Christi TX","lat":27.784,"lng":-97.511},
    {"id":"KCXX","name":"Burlington VT","lat":44.511,"lng":-73.166},
    {"id":"KCYS","name":"Cheyenne WY","lat":41.152,"lng":-104.806},
    {"id":"KDAX","name":"Sacramento CA","lat":38.501,"lng":-121.678},
    {"id":"KDDC","name":"Dodge City KS","lat":37.761,"lng":-99.969},
    {"id":"KDFX","name":"Laughlin TX","lat":29.273,"lng":-100.280},
    {"id":"KDGX","name":"Jackson MS","lat":32.280,"lng":-89.984},
    {"id":"KDIX","name":"Philadelphia PA","lat":39.947,"lng":-74.411},
    {"id":"KDLH","name":"Duluth MN","lat":46.837,"lng":-92.210},
    {"id":"KDMX","name":"Des Moines IA","lat":41.731,"lng":-93.723},
    {"id":"KDOX","name":"Dover DE","lat":38.826,"lng":-75.440},
    {"id":"KDTX","name":"Detroit MI","lat":42.700,"lng":-83.472},
    {"id":"KDVN","name":"Davenport IA","lat":41.612,"lng":-90.581},
    {"id":"KDYX","name":"Dyess TX","lat":32.538,"lng":-99.254},
    {"id":"KEAX","name":"Kansas City MO","lat":38.810,"lng":-94.264},
    {"id":"KEMX","name":"Tucson AZ","lat":31.894,"lng":-110.630},
    {"id":"KENX","name":"Albany NY","lat":42.587,"lng":-74.064},
    {"id":"KEOX","name":"Ft Rucker AL","lat":31.460,"lng":-85.460},
    {"id":"KEPZ","name":"El Paso TX","lat":31.873,"lng":-106.698},
    {"id":"KESX","name":"Las Vegas NV","lat":35.701,"lng":-114.892},
    {"id":"KEVX","name":"Eglin AFB FL","lat":30.565,"lng":-85.922},
    {"id":"KEWX","name":"Austin TX","lat":29.704,"lng":-98.029},
    {"id":"KEYX","name":"Edwards AFB CA","lat":35.098,"lng":-117.561},
    {"id":"KFCX","name":"Blacksburg VA","lat":37.024,"lng":-80.274},
    {"id":"KFDR","name":"Frederick OK","lat":34.362,"lng":-98.976},
    {"id":"KFDX","name":"Cannon AFB NM","lat":34.635,"lng":-103.630},
    {"id":"KFFC","name":"Atlanta GA","lat":33.364,"lng":-84.566},
    {"id":"KFSD","name":"Sioux Falls SD","lat":43.588,"lng":-96.729},
    {"id":"KFSX","name":"Flagstaff AZ","lat":34.574,"lng":-111.198},
    {"id":"KFTG","name":"Denver CO","lat":39.787,"lng":-104.546},
    {"id":"KFWS","name":"Dallas TX","lat":32.573,"lng":-97.303},
    {"id":"KGGW","name":"Glasgow MT","lat":48.206,"lng":-106.625},
    {"id":"KGJX","name":"Grand Junction CO","lat":39.062,"lng":-108.214},
    {"id":"KGLD","name":"Goodland KS","lat":39.367,"lng":-101.700},
    {"id":"KGRB","name":"Green Bay WI","lat":44.498,"lng":-88.111},
    {"id":"KGRK","name":"Ft Hood TX","lat":30.722,"lng":-97.383},
    {"id":"KGRR","name":"Grand Rapids MI","lat":42.894,"lng":-85.545},
    {"id":"KGSP","name":"Greenville SC","lat":34.883,"lng":-82.220},
    {"id":"KGWX","name":"Columbus MS","lat":33.897,"lng":-88.329},
    {"id":"KGYX","name":"Portland ME","lat":43.891,"lng":-70.256},
    {"id":"KHDX","name":"White Sands NM","lat":33.077,"lng":-106.122},
    {"id":"KHGX","name":"Houston TX","lat":29.472,"lng":-95.079},
    {"id":"KHNX","name":"San Joaquin CA","lat":36.314,"lng":-119.632},
    {"id":"KHPX","name":"Ft Campbell KY","lat":36.737,"lng":-87.285},
    {"id":"KHTX","name":"Huntsville AL","lat":34.931,"lng":-86.084},
    {"id":"KICT","name":"Wichita KS","lat":37.655,"lng":-97.443},
    {"id":"KICX","name":"Cedar City UT","lat":37.591,"lng":-112.862},
    {"id":"KILN","name":"Wilmington OH","lat":39.420,"lng":-83.822},
    {"id":"KILX","name":"Lincoln IL","lat":40.151,"lng":-89.337},
    {"id":"KIND","name":"Indianapolis IN","lat":39.707,"lng":-86.280},
    {"id":"KINX","name":"Tulsa OK","lat":36.175,"lng":-95.564},
    {"id":"KIWA","name":"Phoenix AZ","lat":33.289,"lng":-111.670},
    {"id":"KIWX","name":"Fort Wayne IN","lat":41.359,"lng":-85.700},
    {"id":"KJAX","name":"Jacksonville FL","lat":30.485,"lng":-81.702},
    {"id":"KJGX","name":"Robins AFB GA","lat":32.675,"lng":-83.351},
    {"id":"KJKL","name":"Jackson KY","lat":37.591,"lng":-83.313},
    {"id":"KLBB","name":"Lubbock TX","lat":33.654,"lng":-101.814},
    {"id":"KLCH","name":"Lake Charles LA","lat":30.125,"lng":-93.216},
    {"id":"KLGX","name":"Langley Hill WA","lat":47.117,"lng":-124.107},
    {"id":"KLIX","name":"New Orleans LA","lat":30.337,"lng":-89.825},
    {"id":"KLNX","name":"North Platte NE","lat":41.958,"lng":-100.576},
    {"id":"KLOT","name":"Chicago IL","lat":41.604,"lng":-88.085},
    {"id":"KLRX","name":"Elko NV","lat":40.740,"lng":-116.803},
    {"id":"KLSX","name":"St Louis MO","lat":38.699,"lng":-90.683},
    {"id":"KLTX","name":"Wilmington NC","lat":33.989,"lng":-78.430},
    {"id":"KLVX","name":"Louisville KY","lat":37.975,"lng":-85.944},
    {"id":"KLWX","name":"Baltimore MD","lat":38.975,"lng":-77.478},
    {"id":"KLZK","name":"Little Rock AR","lat":34.837,"lng":-92.262},
    {"id":"KMAF","name":"Midland TX","lat":31.943,"lng":-102.189},
    {"id":"KMAX","name":"Medford OR","lat":42.081,"lng":-122.717},
    {"id":"KMBX","name":"Minot ND","lat":48.393,"lng":-100.865},
    {"id":"KMHX","name":"Morehead City NC","lat":34.776,"lng":-76.876},
    {"id":"KMKX","name":"Milwaukee WI","lat":42.968,"lng":-88.551},
    {"id":"KMLB","name":"Melbourne FL","lat":28.113,"lng":-80.654},
    {"id":"KMOB","name":"Mobile AL","lat":30.679,"lng":-88.240},
    {"id":"KMPX","name":"Minneapolis MN","lat":44.849,"lng":-93.565},
    {"id":"KMQT","name":"Marquette MI","lat":46.531,"lng":-87.548},
    {"id":"KMRX","name":"Knoxville TN","lat":36.168,"lng":-83.402},
    {"id":"KMSX","name":"Missoula MT","lat":47.041,"lng":-113.986},
    {"id":"KMTX","name":"Salt Lake City UT","lat":41.263,"lng":-112.448},
    {"id":"KMUX","name":"San Francisco CA","lat":37.155,"lng":-121.898},
    {"id":"KMVX","name":"Grand Forks ND","lat":47.528,"lng":-97.325},
    {"id":"KNKX","name":"San Diego CA","lat":32.919,"lng":-117.042},
    {"id":"KNQA","name":"Memphis TN","lat":35.345,"lng":-89.873},
    {"id":"KOAX","name":"Omaha NE","lat":41.320,"lng":-96.367},
    {"id":"KOHX","name":"Nashville TN","lat":36.247,"lng":-86.563},
    {"id":"KOKX","name":"New York NY","lat":40.866,"lng":-72.864},
    {"id":"KOTX","name":"Spokane WA","lat":47.681,"lng":-117.627},
    {"id":"KPAH","name":"Paducah KY","lat":37.068,"lng":-88.772},
    {"id":"KPBZ","name":"Pittsburgh PA","lat":40.532,"lng":-80.218},
    {"id":"KPDT","name":"Pendleton OR","lat":45.691,"lng":-118.853},
    {"id":"KPOE","name":"Ft Polk LA","lat":31.157,"lng":-92.976},
    {"id":"KPUX","name":"Pueblo CO","lat":38.460,"lng":-104.182},
    {"id":"KRAX","name":"Raleigh NC","lat":35.666,"lng":-78.490},
    {"id":"KRGX","name":"Reno NV","lat":39.754,"lng":-119.462},
    {"id":"KRIW","name":"Riverton WY","lat":43.066,"lng":-108.477},
    {"id":"KRLX","name":"Charleston WV","lat":38.311,"lng":-81.723},
    {"id":"KRTX","name":"Portland OR","lat":45.715,"lng":-122.965},
    {"id":"KSFX","name":"Pocatello ID","lat":43.106,"lng":-112.686},
    {"id":"KSGF","name":"Springfield MO","lat":37.235,"lng":-93.400},
    {"id":"KSHV","name":"Shreveport LA","lat":32.451,"lng":-93.841},
    {"id":"KSJT","name":"San Angelo TX","lat":31.371,"lng":-100.492},
    {"id":"KSOX","name":"Santa Ana CA","lat":33.818,"lng":-117.636},
    {"id":"KSRX","name":"Ft Smith AR","lat":35.291,"lng":-94.362},
    {"id":"KTBW","name":"Tampa FL","lat":27.705,"lng":-82.402},
    {"id":"KTFX","name":"Great Falls MT","lat":47.460,"lng":-111.386},
    {"id":"KTLH","name":"Tallahassee FL","lat":30.398,"lng":-84.329},
    {"id":"KTLX","name":"Oklahoma City OK","lat":35.333,"lng":-97.278},
    {"id":"KTWX","name":"Topeka KS","lat":38.997,"lng":-96.233},
    {"id":"KTYX","name":"Montague NY","lat":43.756,"lng":-75.680},
    {"id":"KUDX","name":"Rapid City SD","lat":44.125,"lng":-103.023},
    {"id":"KUEX","name":"Grand Island NE","lat":40.321,"lng":-98.442},
    {"id":"KVAX","name":"Valdosta GA","lat":30.890,"lng":-83.002},
    {"id":"KVBX","name":"Vandenberg CA","lat":34.839,"lng":-120.397},
    {"id":"KVNX","name":"Vance AFB OK","lat":36.741,"lng":-98.128},
    {"id":"KVTX","name":"Los Angeles CA","lat":34.412,"lng":-119.179},
    {"id":"KVWX","name":"Evansville IN","lat":38.260,"lng":-87.724},
    {"id":"KYUX","name":"Yuma AZ","lat":32.495,"lng":-114.656},
]


@app.route('/api/radar/nearest')
def radar_nearest():
    lat = float(request.args.get('lat', 40.7))
    lng = float(request.args.get('lng', -74.0))
    n   = int(request.args.get('n', 10))
    with_dist = sorted(
        [dict(**s, distKm=round(haversine(lat, lng, s['lat'], s['lng']))) for s in NEXRAD_STATIONS],
        key=lambda x: x['distKm']
    )[:n]
    return jsonify({'stations': with_dist, 'source': 'hardcoded'})


@app.route('/api/radar/level2/latest')
def radar_level2_latest():
    """Get latest Level II scan files from AWS for a station."""
    station = request.args.get('station', 'KOKX').upper()
    product = request.args.get('product', 'reflectivity')  # reflectivity|velocity|zdr|cc
    
    if not NEXRAD_OK:
        return jsonify({'error': 'nexradaws not available'}), 503

    cache_key = f'l2_latest_{station}_{product}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)

    try:
        conn = nexradaws.NexradAwsInterface()
        now = datetime.datetime.utcnow()
        scans = conn.get_available_scans_in_range(
            now - datetime.timedelta(minutes=30), now, station
        )
        if not scans:
            # Try last hour
            scans = conn.get_available_scans_in_range(
                now - datetime.timedelta(hours=1), now, station
            )
        if not scans:
            return jsonify({'error': 'No scans found', 'station': station}), 404

        latest = scans[-1]
        result = {
            'station': station,
            'scan_time': str(latest.scan_time),
            'key': latest.key,
            'filename': latest.filename,
            'available_scans': len(scans),
        }
        cache_set(cache_key, result, 120)
        return jsonify(result)
    except Exception as e:
        log.error(f'Level2 latest error: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/radar/level2/render')
def radar_level2_render():
    """Download and render a Level II scan to PNG tiles using PyART."""
    station = request.args.get('station', 'KOKX').upper()
    product = request.args.get('product', 'reflectivity')
    sweep   = int(request.args.get('sweep', 0))
    
    if not NEXRAD_OK or not PYART_OK or not NUMPY_OK:
        return jsonify({'error': 'PyART or nexradaws not available'}), 503

    cache_key = f'l2_render_{station}_{product}_{sweep}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)

    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        import matplotlib.cm as cm
        import cartopy.crs as ccrs

        conn = nexradaws.NexradAwsInterface()
        now = datetime.datetime.utcnow()
        scans = conn.get_available_scans_in_range(
            now - datetime.timedelta(minutes=45), now, station
        )
        if not scans:
            return jsonify({'error': 'No recent scans'}), 404

        with tempfile.TemporaryDirectory() as tmpdir:
            results = conn.download(scans[-1:], tmpdir)
            if not results.success:
                return jsonify({'error': 'Download failed'}), 500
            
            radar = pyart.io.read_nexrad_archive(results.success[0].filepath)
            
            # Map product name to PyART field
            FIELD_MAP = {
                'reflectivity': 'reflectivity',
                'velocity': 'velocity',
                'zdr': 'differential_reflectivity',
                'cc': 'cross_correlation_ratio',
                'kdp': 'specific_differential_phase',
                'sw': 'spectrum_width',
            }
            field = FIELD_MAP.get(product, 'reflectivity')
            
            if field not in radar.fields:
                # Fallback
                field = list(radar.fields.keys())[0]

            # Render to PNG
            fig = plt.figure(figsize=(8, 8), dpi=100)
            ax = plt.subplot(111, projection=ccrs.PlateCarree())
            
            display = pyart.graph.RadarMapDisplay(radar)
            
            # Product-specific colormap and range
            CMAPS = {
                'reflectivity': ('pyart_NWSRef', -20, 80),
                'velocity':     ('pyart_NWSVel', -30, 30),
                'differential_reflectivity': ('pyart_HomeyerRainbow', -2, 6),
                'cross_correlation_ratio':   ('pyart_BlueBrown11', 0.6, 1.05),
                'specific_differential_phase': ('pyart_Theodore16', -2, 6),
                'spectrum_width': ('pyart_NWSRef', 0, 10),
            }
            cmap, vmin, vmax = CMAPS.get(field, ('pyart_NWSRef', -20, 80))
            
            try:
                display.plot_ppi_map(
                    field, sweep=sweep, ax=ax,
                    vmin=vmin, vmax=vmax,
                    cmap=cmap,
                    title='',
                    colorbar_flag=False,
                )
            except Exception:
                display.plot_ppi_map(field, sweep=sweep, ax=ax, title='', colorbar_flag=False)

            ax.set_axis_off()
            plt.tight_layout(pad=0)
            
            buf = io.BytesIO()
            plt.savefig(buf, format='png', bbox_inches='tight', pad_inches=0,
                       transparent=True, dpi=100)
            plt.close(fig)
            buf.seek(0)

            import base64
            img_b64 = base64.b64encode(buf.read()).decode()
            
            # Get radar extent for map overlay positioning
            lats = [radar.latitude['data'][0]]
            lons = [radar.longitude['data'][0]]
            max_range_km = radar.instrument_parameters['unambiguous_range']['data'][0] / 1000 if 'unambiguous_range' in (radar.instrument_parameters or {}) else 250
            
            result = {
                'station': station,
                'product': product,
                'field': field,
                'sweep': sweep,
                'scan_time': str(radar.time['units']),
                'lat': float(lats[0]),
                'lng': float(lons[0]),
                'range_km': float(max_range_km),
                'image_b64': img_b64,
                'available_sweeps': radar.nsweeps,
                'available_fields': list(radar.fields.keys()),
            }
            cache_set(cache_key, result, 300)
            return jsonify(result)

    except Exception as e:
        log.error(f'Level2 render error: {e}')
        return jsonify({'error': str(e), 'station': station, 'product': product}), 500


@app.route('/api/radar/level2/skewtdata')
def skewt_data():
    """Get sounding data for Skew-T diagram via University of Wyoming."""
    lat  = float(request.args.get('lat', 40.7))
    lng  = float(request.args.get('lng', -74.0))
    date = request.args.get('date', '')  # YYYYMMDDHH or empty for latest
    
    cache_key = f'skewt_{lat:.1f}_{lng:.1f}_{date}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)

    try:
        import requests as req
        
        # Find nearest upper-air sounding station
        # Use University of Wyoming's sounding API
        if not date:
            now = datetime.datetime.utcnow()
            # Soundings are at 00Z and 12Z
            if now.hour < 6:
                snd_hour = '00'
                snd_date = (now - datetime.timedelta(days=1)).strftime('%Y%m%d')
            elif now.hour < 18:
                snd_hour = '12'
                snd_date = now.strftime('%Y%m%d')
            else:
                snd_hour = '00'
                snd_date = now.strftime('%Y%m%d')
        else:
            snd_date = date[:8]
            snd_hour = date[8:10] if len(date) > 8 else '12'

        # Wyoming sounding API — find nearest station
        # We'll use the region-based approach with the US network
        year  = snd_date[:4]
        month = snd_date[4:6]
        day   = snd_date[6:8]
        
        # Nearest RAOB stations (simplified — real implementation would use a full DB)
        RAOB_STATIONS = [
            {'id':'72501','name':'Upton NY','lat':40.87,'lng':-72.86},
            {'id':'72528','name':'Albany NY','lat':42.75,'lng':-73.80},
            {'id':'72208','name':'Jacksonville FL','lat':30.35,'lng':-81.65},
            {'id':'72210','name':'Tampa FL','lat':27.97,'lng':-82.52},
            {'id':'72301','name':'Lake Charles LA','lat':30.12,'lng':-93.22},
            {'id':'72357','name':'Norman OK','lat':35.18,'lng':-97.44},
            {'id':'72402','name':'Little Rock AR','lat':34.74,'lng':-92.23},
            {'id':'72426','name':'Davenport IA','lat':41.55,'lng':-90.58},
            {'id':'72451','name':'North Platte NE','lat':41.13,'lng':-100.68},
            {'id':'72469','name':'Denver CO','lat':39.75,'lng':-104.87},
            {'id':'72572','name':'Elko NV','lat':40.83,'lng':-115.79},
            {'id':'72681','name':'Oakland CA','lat':37.73,'lng':-122.22},
            {'id':'72694','name':'Salem OR','lat':44.92,'lng':-123.00},
            {'id':'72786','name':'Fairbanks AK','lat':64.82,'lng':-147.86},
            {'id':'72202','name':'Key West FL','lat':24.55,'lng':-81.75},
            {'id':'72364','name':'Dallas TX','lat':32.85,'lng':-97.30},
            {'id':'72558','name':'Amarillo TX','lat':35.23,'lng':-101.71},
            {'id':'72645','name':'Salt Lake City UT','lat':40.77,'lng':-111.97},
        ]
        nearest = min(RAOB_STATIONS, key=lambda s: haversine(lat, lng, s['lat'], s['lng']))
        
        url = f'https://weather.uwyo.edu/cgi-bin/bufrraob.py?year={year}&month={month}&from={day}{snd_hour}&to={day}{snd_hour}&stnm={nearest["id"]}&type=TEXT:LIST'
        r = req.get(url, timeout=10)
        
        if r.ok and len(r.text) > 200:
            lines = r.text.strip().split('\n')
            data_lines = [l for l in lines if l.strip() and not l.startswith('<') and not l.startswith('%')]
            
            pressures, temps, dewpoints, winds_u, winds_v = [], [], [], [], []
            
            for line in data_lines[6:]:
                parts = line.split()
                if len(parts) >= 5:
                    try:
                        p   = float(parts[0])
                        t   = float(parts[2])
                        td  = float(parts[3])
                        wdir= float(parts[6]) if len(parts) > 6 else 0
                        wspd= float(parts[7]) if len(parts) > 7 else 0
                        if 1000 >= p >= 10:
                            wdir_rad = math.radians(wdir)
                            pressures.append(p)
                            temps.append(t)
                            dewpoints.append(td)
                            winds_u.append(-wspd * math.sin(wdir_rad))
                            winds_v.append(-wspd * math.cos(wdir_rad))
                    except (ValueError, IndexError):
                        continue
            
            result = {
                'station': nearest,
                'date': f'{year}-{month}-{day} {snd_hour}Z',
                'pressure': pressures,
                'temperature': temps,
                'dewpoint': dewpoints,
                'wind_u': winds_u,
                'wind_v': winds_v,
                'levels': len(pressures),
            }
            cache_set(cache_key, result, 3600)
            return jsonify(result)
        else:
            return jsonify({'error': 'Sounding data unavailable', 'station': nearest}), 404

    except Exception as e:
        log.error(f'Skew-T error: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/metar/nearest')
def metar_nearest():
    """Get METARs from nearby airports via aviationweather.gov."""
    lat    = float(request.args.get('lat', 40.7))
    lng    = float(request.args.get('lng', -74.0))
    radius = int(request.args.get('radius', 50))
    
    cache_key = f'metar_{lat:.1f}_{lng:.1f}_{radius}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)

    try:
        import requests as req
        url = f'https://aviationweather.gov/api/data/metar?bbox={lat-radius/111},{lng-radius/111},{lat+radius/111},{lng+radius/111}&format=json'
        r = req.get(url, timeout=8, headers={'User-Agent': 'StormSurgeWeather/14.0'})
        if r.ok:
            data = r.json()
            result = {'metars': data[:20], 'count': len(data), 'lat': lat, 'lng': lng}
            cache_set(cache_key, result, 600)
            return jsonify(result)
        return jsonify({'error': 'METAR unavailable'}), 502
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/taf/station')
def taf_station():
    """Get TAF for a specific airport station."""
    station = request.args.get('station', 'KJFK').upper()
    cache_key = f'taf_{station}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)
    try:
        import requests as req
        url = f'https://aviationweather.gov/api/data/taf?ids={station}&format=json'
        r = req.get(url, timeout=8, headers={'User-Agent': 'StormSurgeWeather/14.0'})
        if r.ok:
            data = r.json()
            result = {'taf': data, 'station': station}
            cache_set(cache_key, result, 1800)
            return jsonify(result)
        return jsonify({'error': 'TAF unavailable'}), 502
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/lightning')
def lightning():
    """Get recent GLM lightning data from NOAA/GOES."""
    lat = float(request.args.get('lat', 40.7))
    lng = float(request.args.get('lng', -74.0))
    minutes = int(request.args.get('minutes', 15))
    
    cache_key = f'lightning_{lat:.1f}_{lng:.1f}_{minutes}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)

    try:
        import requests as req
        # Blitzortung global lightning network — free, real-time
        now = int(time.time())
        url = f'https://data.blitzortung.org/Data_1/strikes?a={lat-5}&b={lng-5}&c={lat+5}&d={lng+5}&time={now - minutes*60}'
        r = req.get(url, timeout=6, headers={'User-Agent': 'StormSurgeWeather/14.0'})
        if r.ok:
            strikes = r.json()
            result = {
                'strikes': strikes[:500],
                'count': len(strikes),
                'lat': lat, 'lng': lng,
                'minutes': minutes,
            }
            cache_set(cache_key, result, 60)
            return jsonify(result)
        return jsonify({'strikes': [], 'count': 0}), 200
    except Exception as e:
        return jsonify({'strikes': [], 'error': str(e)}), 200


@app.route('/api/pollen')
def pollen():
    """Pollen count using Open-Meteo air quality (pollen fields)."""
    lat = float(request.args.get('lat', 40.7))
    lng = float(request.args.get('lng', -74.0))
    cache_key = f'pollen_{lat:.1f}_{lng:.1f}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)
    try:
        import requests as req
        url = (f'https://air-quality-api.open-meteo.com/v1/air-quality'
               f'?latitude={lat}&longitude={lng}'
               f'&hourly=alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen'
               f'&forecast_days=3&timezone=auto')
        r = req.get(url, timeout=8)
        if r.ok:
            data = r.json()
            cache_set(cache_key, data, 3600)
            return jsonify(data)
        return jsonify({'error': 'Pollen data unavailable'}), 502
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/tide')
def tide():
    """Tidal predictions from NOAA CO-OPS API."""
    lat = float(request.args.get('lat', 40.7))
    lng = float(request.args.get('lng', -74.0))
    cache_key = f'tide_{lat:.1f}_{lng:.1f}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)
    try:
        import requests as req
        # Find nearest tide station
        stations_url = f'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions&units=english'
        r = req.get(stations_url, timeout=8)
        if r.ok:
            stations = r.json().get('stations', [])
            nearest = min(
                [s for s in stations if s.get('lat') and s.get('lng')],
                key=lambda s: haversine(lat, lng, float(s['lat']), float(s['lng'])),
                default=None
            )
            if nearest:
                sid  = nearest['id']
                today = datetime.datetime.utcnow().strftime('%Y%m%d')
                tomorrow = (datetime.datetime.utcnow() + datetime.timedelta(days=2)).strftime('%Y%m%d')
                pred_url = (f'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter'
                           f'?begin_date={today}&end_date={tomorrow}'
                           f'&station={sid}&product=predictions&datum=MLLW'
                           f'&time_zone=lst_ldt&interval=hilo&units=english&application=StormSurge&format=json')
                r2 = req.get(pred_url, timeout=8)
                if r2.ok:
                    pred_data = r2.json()
                    result = {
                        'station': nearest,
                        'predictions': pred_data.get('predictions', []),
                    }
                    cache_set(cache_key, result, 3600)
                    return jsonify(result)
        return jsonify({'error': 'Tide data unavailable'}), 502
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/gdd')
def growing_degree_days():
    """Growing Degree Days for agriculture — base 50°F, from Open-Meteo."""
    lat  = float(request.args.get('lat', 40.7))
    lng  = float(request.args.get('lng', -74.0))
    base = float(request.args.get('base', 50))  # base temp in °F
    cache_key = f'gdd_{lat:.1f}_{lng:.1f}_{base}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)
    try:
        import requests as req
        # Get last 30 days + 7-day forecast daily max/min temps
        end = datetime.date.today()
        start = end - datetime.timedelta(days=30)
        url = (f'https://api.open-meteo.com/v1/forecast'
               f'?latitude={lat}&longitude={lng}'
               f'&daily=temperature_2m_max,temperature_2m_min'
               f'&start_date={start}&end_date={end + datetime.timedelta(days=7)}'
               f'&temperature_unit=fahrenheit&timezone=auto')
        r = req.get(url, timeout=8)
        if r.ok:
            d = r.json()
            days  = d['daily']['time']
            tmax  = d['daily']['temperature_2m_max']
            tmin  = d['daily']['temperature_2m_min']
            # GDD = max(0, (Tmax + Tmin) / 2 - base)
            gdd_vals = []
            cumulative = 0
            for i, day in enumerate(days):
                if tmax[i] is None or tmin[i] is None:
                    gdd_vals.append({'date': day, 'gdd': 0, 'cumulative': cumulative})
                    continue
                daily_gdd = max(0, (tmax[i] + tmin[i]) / 2 - base)
                cumulative += daily_gdd
                gdd_vals.append({'date': day, 'gdd': round(daily_gdd, 1), 'cumulative': round(cumulative, 1)})
            result = {'gdd': gdd_vals, 'base_temp': base, 'lat': lat, 'lng': lng}
            cache_set(cache_key, result, 3600)
            return jsonify(result)
        return jsonify({'error': 'GDD data unavailable'}), 502
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/ensemble')
def ensemble_models():
    """Compare GFS vs ECMWF ensemble spread via Open-Meteo."""
    lat = float(request.args.get('lat', 40.7))
    lng = float(request.args.get('lng', -74.0))
    cache_key = f'ensemble_{lat:.1f}_{lng:.1f}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)
    try:
        import requests as req
        results = {}
        models = {
            'gfs': 'gfs_seamless',
            'ecmwf': 'ecmwf_ifs025',
            'icon': 'icon_seamless',
            'gem': 'gem_seamless',
        }
        for name, model in models.items():
            url = (f'https://api.open-meteo.com/v1/forecast'
                   f'?latitude={lat}&longitude={lng}&models={model}'
                   f'&hourly=temperature_2m,precipitation,wind_speed_10m'
                   f'&forecast_days=7&timezone=auto')
            try:
                r = req.get(url, timeout=8)
                if r.ok:
                    results[name] = r.json()
            except Exception:
                pass
        cache_set(cache_key, results, 3600)
        return jsonify(results)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/alerts/custom')
def custom_alerts():
    """Evaluate custom alert conditions against current weather."""
    lat        = float(request.args.get('lat', 40.7))
    lng        = float(request.args.get('lng', -74.0))
    conditions = request.args.get('conditions', '')  # JSON-encoded list
    
    try:
        conds = json.loads(conditions) if conditions else []
    except Exception:
        conds = []

    try:
        import requests as req
        url = (f'https://api.open-meteo.com/v1/forecast'
               f'?latitude={lat}&longitude={lng}'
               f'&current=temperature_2m,apparent_temperature,wind_speed_10m,wind_gusts_10m,'
               f'precipitation,weather_code,relative_humidity_2m,visibility,surface_pressure'
               f'&timezone=auto')
        r = req.get(url, timeout=8)
        if not r.ok:
            return jsonify({'error': 'Weather unavailable'}), 502
        wx = r.json()['current']
        
        triggered = []
        for cond in conds:
            try:
                field  = cond.get('field', '')
                op     = cond.get('op', '>')
                value  = float(cond.get('value', 0))
                label  = cond.get('label', f'{field} {op} {value}')
                
                current_val = wx.get(field)
                if current_val is None:
                    continue
                
                match = False
                if op == '>':  match = float(current_val) > value
                elif op == '>=': match = float(current_val) >= value
                elif op == '<':  match = float(current_val) < value
                elif op == '<=': match = float(current_val) <= value
                elif op == '==': match = float(current_val) == value
                
                if match:
                    triggered.append({
                        'label': label,
                        'field': field,
                        'current': current_val,
                        'op': op,
                        'threshold': value,
                    })
            except Exception:
                pass
        
        return jsonify({
            'triggered': triggered,
            'current': wx,
            'conditions_checked': len(conds),
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/health')
def health():
    return jsonify({
        'status': 'ok',
        'nexradaws': NEXRAD_OK,
        'pyart': PYART_OK,
        'numpy': NUMPY_OK,
        'version': '14.0',
    })


if __name__ == '__main__':
    port = int(os.environ.get('RADAR_PORT', 3002))
    log.info(f'Starting radar microservice on port {port}')
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
