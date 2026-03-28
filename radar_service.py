#!/usr/bin/env python3
"""
Storm Surge Weather — Python Radar Microservice v14.0
Renders NEXRAD Level II using nexradaws + numpy + matplotlib only.
No PyART, no cartopy, no pygrib required.
"""

import os, io, json, math, datetime, tempfile, threading, time, logging, struct, gzip
from pathlib import Path
from flask import Flask, jsonify, request, send_file, Response
from flask_cors import CORS

logging.basicConfig(level=logging.INFO)
log = logging.getLogger('radar_service')

app = Flask(__name__)
CORS(app)

# ── Cache ────────────────────────────────────────────────────────
_cache = {}
def cache_get(key):
    v = _cache.get(key)
    if v and v['exp'] > time.time(): return v['data']
    return None
def cache_set(key, data, ttl=300):
    _cache[key] = {'data': data, 'exp': time.time() + ttl}

# ── Package availability ─────────────────────────────────────────
try:
    import nexradaws
    NEXRAD_OK = True
    log.info("nexradaws OK")
except ImportError:
    NEXRAD_OK = False
    log.warning("nexradaws not available")

try:
    import numpy as np
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import matplotlib.colors as mcolors
    PLOT_OK = True
    log.info("matplotlib/numpy OK")
except ImportError:
    PLOT_OK = False
    log.warning("matplotlib/numpy not available")

def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

# ── All 160 NEXRAD WSR-88D stations ─────────────────────────────
NEXRAD_STATIONS = [
    {"id":"KABR","name":"Aberdeen SD","lat":45.456,"lng":-98.413},
    {"id":"KABX","name":"Albuquerque NM","lat":35.150,"lng":-106.824},
    {"id":"KAKQ","name":"Wakefield VA","lat":36.984,"lng":-77.008},
    {"id":"KALY","name":"Albany NY","lat":42.747,"lng":-73.838},
    {"id":"KAMX","name":"Miami FL","lat":25.611,"lng":-80.413},
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
    {"id":"KENX","name":"Albany NY (East)","lat":42.587,"lng":-74.064},
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


def _nws_reflectivity_cmap():
    """NWS standard reflectivity colormap."""
    colors = [
        (0.00, '#646464'), (0.01, '#04e9e7'), (0.10, '#019ff4'),
        (0.20, '#0300f4'), (0.30, '#02fd02'), (0.40, '#01c501'),
        (0.50, '#008e00'), (0.60, '#fdf802'), (0.70, '#e5bc00'),
        (0.80, '#fd9500'), (0.90, '#fd0000'), (0.95, '#d40000'),
        (1.00, '#bc0000'),
    ]
    return mcolors.LinearSegmentedColormap.from_list('nws_ref', colors)

def _nws_velocity_cmap():
    """NWS velocity colormap (green=toward, red=away)."""
    colors = [
        (0.00, '#00008B'), (0.15, '#0000FF'), (0.30, '#00BFFF'),
        (0.45, '#00FF00'), (0.50, '#808080'), (0.55, '#FFFF00'),
        (0.70, '#FF8C00'), (0.85, '#FF0000'), (1.00, '#8B0000'),
    ]
    return mcolors.LinearSegmentedColormap.from_list('nws_vel', colors)

def _parse_nexrad_level2(filepath, product='reflectivity'):
    """
    Parse NEXRAD Level II archive file (AR2V format) using pure Python.
    Returns (azimuth_angles, ranges_km, data_2d, radar_lat, radar_lon, elevation_deg)
    """
    import struct

    PRODUCTS = {
        'reflectivity': {'moment': b'REF ', 'scale': 0.5, 'offset': 66.0},
        'velocity':     {'moment': b'VEL ', 'scale': 0.5, 'offset': 129.0},
        'zdr':          {'moment': b'ZDR ', 'scale': 0.0625, 'offset': 128.0},
        'cc':           {'moment': b'RHO ', 'scale': 0.00333, 'offset': -0.33},
        'sw':           {'moment': b'SW  ', 'scale': 0.5, 'offset': 129.0},
    }

    prod_info = PRODUCTS.get(product, PRODUCTS['reflectivity'])

    with open(filepath, 'rb') as f:
        # Skip 24-byte volume header
        header = f.read(24)
        if header[:4] == b'AR2V':
            pass  # standard format
        elif header[:4] == b'\x1f\x8b':
            # gzip compressed
            f.seek(0)
            import gzip as gz_mod
            data = gz_mod.decompress(f.read())
            import io
            f = io.BytesIO(data)
            f.read(24)

        azimuths, data_radials = [], []
        radar_lat = radar_lon = elev = None
        gates = 1832
        range_start_km = 2.125
        gate_size_km = 0.25

        while True:
            # Read message header (28 bytes)
            msg_hdr = f.read(28)
            if len(msg_hdr) < 28:
                break

            # LDM record size (first 4 bytes, big-endian int)
            try:
                msg_size = struct.unpack('>I', msg_hdr[:4])[0] & 0x7FFFFFFF
                msg_type = struct.unpack('B', msg_hdr[15:16])[0]
            except Exception:
                break

            if msg_size < 28:
                break

            payload = f.read(msg_size - 28)
            if len(payload) < msg_size - 28:
                break

            if msg_type == 31:
                # Digital Radar Data Generic Format (Msg 31)
                try:
                    az  = struct.unpack('>f', payload[4:8])[0]
                    el  = struct.unpack('>f', payload[8:12])[0]
                    rlat= struct.unpack('>f', payload[20:24])[0]
                    rlon= struct.unpack('>f', payload[24:28])[0]
                    if radar_lat is None and -90 <= rlat <= 90:
                        radar_lat, radar_lon, elev = rlat, rlon, el

                    # Find data block for this product
                    num_blocks = struct.unpack('>H', payload[18:20])[0]
                    blk_ptr_offset = 28  # data block pointers start here
                    for b in range(min(num_blocks, 9)):
                        ptr = struct.unpack('>I', payload[blk_ptr_offset + b*4: blk_ptr_offset + b*4 + 4])[0]
                        if ptr == 0 or ptr >= len(payload):
                            continue
                        blk_type = payload[ptr:ptr+1]
                        blk_name = payload[ptr+1:ptr+4]
                        full_name = blk_type + blk_name
                        if full_name[:4] == prod_info['moment'][:4] or blk_name == prod_info['moment'][:3]:
                            num_gates = struct.unpack('>H', payload[ptr+8:ptr+10])[0]
                            first_gate_m = struct.unpack('>H', payload[ptr+10:ptr+12])[0]
                            gate_size_m  = struct.unpack('>H', payload[ptr+12:ptr+14])[0]
                            scale  = struct.unpack('>f', payload[ptr+20:ptr+24])[0]
                            offset = struct.unpack('>f', payload[ptr+24:ptr+28])[0]
                            raw = np.frombuffer(payload[ptr+28:ptr+28+num_gates], dtype=np.uint8).astype(float)
                            # Convert: val = (raw - offset) / scale, mask 0 and 1
                            data = np.where(raw <= 1, np.nan, (raw - offset) / scale)
                            azimuths.append(az)
                            data_radials.append(data)
                            gates = num_gates
                            range_start_km = first_gate_m / 1000.0
                            gate_size_km   = gate_size_m  / 1000.0
                            break
                except Exception:
                    continue

    if not azimuths:
        return None

    # Sort by azimuth
    order = np.argsort(azimuths)
    azimuths = np.array(azimuths)[order]
    max_gates = max(len(r) for r in data_radials)
    grid = np.full((len(data_radials), max_gates), np.nan)
    for i, r in enumerate(data_radials):
        grid[order[i], :len(r)] = r

    ranges_km = range_start_km + np.arange(max_gates) * gate_size_km

    return azimuths, ranges_km, grid, radar_lat or 40.0, radar_lon or -74.0, elev or 0.5


def _render_ppi(azimuths, ranges_km, data, product, station, scan_time):
    """Render PPI sweep to PNG using polar-to-Cartesian conversion."""
    fig, ax = plt.subplots(1, 1, figsize=(8, 8), facecolor='#0b0f1a')
    ax.set_facecolor('#0b0f1a')

    cmap = _nws_reflectivity_cmap() if product == 'reflectivity' else _nws_velocity_cmap()
    vmin, vmax = (-20, 80) if product == 'reflectivity' else (-30, 30)
    if product == 'zdr':   vmin, vmax = -2, 6
    if product == 'cc':    vmin, vmax = 0.6, 1.05
    if product == 'sw':    vmin, vmax = 0, 10

    # Convert polar to Cartesian
    az_rad = np.radians(azimuths)
    R, A = np.meshgrid(ranges_km, az_rad)
    X = R * np.sin(A)
    Y = R * np.cos(A)

    max_range = float(np.nanmax(ranges_km))
    im = ax.pcolormesh(X, Y, data, cmap=cmap, vmin=vmin, vmax=vmax, shading='nearest')

    # Range rings
    for ring_km in [50, 100, 150, 200, 250]:
        if ring_km <= max_range:
            circle = plt.Circle((0, 0), ring_km, fill=False,
                                color='rgba(255,255,255,0.15)' if False else 'white',
                                alpha=0.12, linewidth=0.8)
            ax.add_patch(circle)
            ax.text(0, ring_km, f'{ring_km}km', ha='center', va='bottom',
                   color='white', alpha=0.3, fontsize=7)

    # Azimuth spokes
    for spoke_az in range(0, 360, 30):
        rad = math.radians(spoke_az)
        ax.plot([0, max_range * math.sin(rad)], [0, max_range * math.cos(rad)],
               color='white', alpha=0.08, linewidth=0.5)

    # Radar location dot
    ax.plot(0, 0, 'w+', markersize=8, markeredgewidth=1.5, alpha=0.8)

    ax.set_xlim(-max_range, max_range)
    ax.set_ylim(-max_range, max_range)
    ax.set_aspect('equal')
    ax.axis('off')

    # Colorbar
    cbar = plt.colorbar(im, ax=ax, fraction=0.03, pad=0.01, orientation='vertical')
    cbar.ax.tick_params(colors='white', labelsize=8)
    unit = {'reflectivity':'dBZ','velocity':'m/s','zdr':'dB','cc':'ρhv','sw':'m/s'}.get(product,'')
    cbar.set_label(unit, color='white', fontsize=9)

    # Title
    ax.set_title(f'{station}  {product.upper()}  {scan_time}',
                color='white', fontsize=10, pad=4)

    plt.tight_layout(pad=0.3)
    buf = io.BytesIO()
    plt.savefig(buf, format='png', dpi=100, bbox_inches='tight',
               facecolor='#0b0f1a', transparent=False)
    plt.close(fig)
    buf.seek(0)
    import base64
    return base64.b64encode(buf.read()).decode()


@app.route('/api/radar/level2/render')
def radar_level2_render():
    station = request.args.get('station', 'KOKX').upper()
    product = request.args.get('product', 'reflectivity')

    if not NEXRAD_OK:
        return jsonify({'error': 'nexradaws not installed. Run: pip install nexradaws'}), 503
    if not PLOT_OK:
        return jsonify({'error': 'matplotlib not installed. Run: pip install matplotlib numpy'}), 503

    cache_key = f'l2_render_{station}_{product}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)

    try:
        conn = nexradaws.NexradAwsInterface()
        now  = datetime.datetime.utcnow()
        scans = conn.get_available_scans_in_range(
            now - datetime.timedelta(minutes=60), now, station
        )
        if not scans:
            return jsonify({'error': f'No recent scans found for {station}'}), 404

        latest = scans[-1]
        scan_time = str(latest.scan_time)

        with tempfile.TemporaryDirectory() as tmpdir:
            results = conn.download(scans[-1:], tmpdir)
            if not results.success:
                return jsonify({'error': 'Download from AWS S3 failed'}), 500

            filepath = results.success[0].filepath
            parsed = _parse_nexrad_level2(filepath, product)

            if parsed is None:
                return jsonify({
                    'error': f'Could not parse {product} from scan. Available products depend on VCP.',
                    'station': station, 'scan_time': scan_time
                }), 422

            azimuths, ranges_km, data, rlat, rlon, elev = parsed
            img_b64 = _render_ppi(azimuths, ranges_km, data, product, station, scan_time[:19])

            result = {
                'station': station,
                'product': product,
                'scan_time': scan_time,
                'lat': rlat, 'lng': rlon,
                'elevation_deg': round(elev, 2),
                'range_km': round(float(np.nanmax(ranges_km)), 1),
                'num_radials': len(azimuths),
                'image_b64': img_b64,
                'available_fields': ['reflectivity', 'velocity', 'zdr', 'cc', 'sw'],
            }
            cache_set(cache_key, result, 300)
            return jsonify(result)

    except Exception as e:
        log.error(f'Level2 render error: {e}', exc_info=True)
        return jsonify({'error': str(e), 'station': station}), 500


@app.route('/api/radar/level2/latest')
def radar_level2_latest():
    station = request.args.get('station', 'KOKX').upper()
    if not NEXRAD_OK:
        return jsonify({'error': 'nexradaws not installed'}), 503
    cache_key = f'l2_latest_{station}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)
    try:
        conn  = nexradaws.NexradAwsInterface()
        now   = datetime.datetime.utcnow()
        scans = conn.get_available_scans_in_range(now - datetime.timedelta(minutes=60), now, station)
        if not scans:
            return jsonify({'error': 'No scans found'}), 404
        latest = scans[-1]
        result = {'station': station, 'scan_time': str(latest.scan_time),
                  'key': latest.key, 'available': len(scans)}
        cache_set(cache_key, result, 120)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/radar/skewtdata')
def skewt_data():
    lat  = float(request.args.get('lat', 40.7))
    lng  = float(request.args.get('lng', -74.0))
    cache_key = f'skewt_{lat:.1f}_{lng:.1f}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)
    try:
        import requests as req
        RAOB = [
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
            {'id':'72476','name':'Rapid City SD','lat':44.07,'lng':-103.07},
            {'id':'72562','name':'Topeka KS','lat':39.07,'lng':-95.63},
            {'id':'72261','name':'Corpus Christi TX','lat':27.77,'lng':-97.50},
            {'id':'72317','name':'Shreveport LA','lat':32.52,'lng':-93.82},
            {'id':'72327','name':'Jackson MS','lat':32.32,'lng':-90.08},
            {'id':'72340','name':'Nashville TN','lat':36.25,'lng':-86.57},
        ]
        nearest = min(RAOB, key=lambda s: haversine(lat, lng, s['lat'], s['lng']))
        now = datetime.datetime.utcnow()
        snd_hour = '00' if now.hour < 12 else '12'
        y, m, d = now.strftime('%Y'), now.strftime('%m'), now.strftime('%d')
        url = (f'https://weather.uwyo.edu/cgi-bin/bufrraob.py'
               f'?year={y}&month={m}&from={d}{snd_hour}&to={d}{snd_hour}'
               f'&stnm={nearest["id"]}&type=TEXT:LIST')
        r = req.get(url, timeout=12, headers={'User-Agent': 'StormSurgeWeather/14.0'})
        if not r.ok or len(r.text) < 200:
            return jsonify({'error': 'Sounding data unavailable', 'station': nearest}), 404
        lines = [l for l in r.text.split('\n') if l.strip() and not l.startswith('<') and not l.startswith('%')]
        pressures, temps, dews, wu, wv = [], [], [], [], []
        for line in lines[6:]:
            parts = line.split()
            if len(parts) < 5:
                continue
            try:
                p = float(parts[0])
                if not (1 <= p <= 1050): continue
                t  = float(parts[2])
                td = float(parts[3])
                wd = float(parts[6]) if len(parts) > 6 else 0
                ws = float(parts[7]) if len(parts) > 7 else 0
                wr = math.radians(wd)
                pressures.append(p); temps.append(t); dews.append(td)
                wu.append(-ws * math.sin(wr)); wv.append(-ws * math.cos(wr))
            except (ValueError, IndexError):
                continue
        if not pressures:
            return jsonify({'error': 'No valid sounding levels parsed', 'station': nearest}), 404
        result = {'station': nearest, 'date': f'{y}-{m}-{d} {snd_hour}Z',
                  'pressure': pressures, 'temperature': temps, 'dewpoint': dews,
                  'wind_u': wu, 'wind_v': wv, 'levels': len(pressures)}
        cache_set(cache_key, result, 3600)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/metar/nearest')
def metar_nearest():
    lat    = float(request.args.get('lat', 40.7))
    lng    = float(request.args.get('lng', -74.0))
    radius = int(request.args.get('radius', 80))
    cache_key = f'metar_{lat:.1f}_{lng:.1f}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)
    try:
        import requests as req
        deg = radius / 111.0
        url = (f'https://aviationweather.gov/api/data/metar'
               f'?bbox={lat-deg},{lng-deg},{lat+deg},{lng+deg}&format=json')
        r = req.get(url, timeout=8, headers={'User-Agent': 'StormSurgeWeather/14.0'})
        if r.ok:
            data = r.json()
            result = {'metars': data[:20], 'count': len(data)}
            cache_set(cache_key, result, 600)
            return jsonify(result)
        return jsonify({'metars': [], 'error': 'aviationweather.gov unavailable'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/metar/station')
def metar_station():
    station = request.args.get('station', 'KJFK').upper()
    cache_key = f'metar_sta_{station}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)
    try:
        import requests as req
        url = f'https://aviationweather.gov/api/data/metar?ids={station}&format=json'
        r = req.get(url, timeout=8, headers={'User-Agent': 'StormSurgeWeather/14.0'})
        if r.ok:
            data = r.json()
            result = {'metars': data, 'station': station}
            cache_set(cache_key, result, 600)
            return jsonify(result)
        return jsonify({'metars': [], 'error': 'METAR unavailable'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/taf/station')
def taf_station():
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
            result = {'taf': r.json(), 'station': station}
            cache_set(cache_key, result, 1800)
            return jsonify(result)
        return jsonify({'taf': [], 'error': 'TAF unavailable'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/pollen')
def pollen():
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
    lat = float(request.args.get('lat', 40.7))
    lng = float(request.args.get('lng', -74.0))
    cache_key = f'tide_{lat:.1f}_{lng:.1f}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)
    try:
        import requests as req
        r = req.get('https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions&units=english', timeout=10)
        if r.ok:
            stations = r.json().get('stations', [])
            nearest = min(
                [s for s in stations if s.get('lat') and s.get('lng')],
                key=lambda s: haversine(lat, lng, float(s['lat']), float(s['lng'])),
                default=None
            )
            if nearest:
                sid = nearest['id']
                today = datetime.datetime.utcnow().strftime('%Y%m%d')
                end   = (datetime.datetime.utcnow() + datetime.timedelta(days=2)).strftime('%Y%m%d')
                pred_url = (f'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter'
                           f'?begin_date={today}&end_date={end}&station={sid}'
                           f'&product=predictions&datum=MLLW&time_zone=lst_ldt'
                           f'&interval=hilo&units=english&application=StormSurge&format=json')
                r2 = req.get(pred_url, timeout=8)
                if r2.ok:
                    result = {'station': nearest, 'predictions': r2.json().get('predictions', [])}
                    cache_set(cache_key, result, 3600)
                    return jsonify(result)
        return jsonify({'error': 'Tide data unavailable (inland location?)'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/gdd')
def gdd():
    lat  = float(request.args.get('lat', 40.7))
    lng  = float(request.args.get('lng', -74.0))
    base = float(request.args.get('base', 50))
    cache_key = f'gdd_{lat:.1f}_{lng:.1f}_{base}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)
    try:
        import requests as req
        end   = datetime.date.today()
        start = end - datetime.timedelta(days=30)
        url = (f'https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lng}'
               f'&daily=temperature_2m_max,temperature_2m_min'
               f'&start_date={start}&end_date={end + datetime.timedelta(days=7)}'
               f'&temperature_unit=fahrenheit&timezone=auto')
        r = req.get(url, timeout=8)
        if r.ok:
            d = r.json()
            days, tmax, tmin = d['daily']['time'], d['daily']['temperature_2m_max'], d['daily']['temperature_2m_min']
            gdd_vals, cum = [], 0
            for i, day in enumerate(days):
                if tmax[i] is None or tmin[i] is None:
                    gdd_vals.append({'date': day, 'gdd': 0, 'cumulative': round(cum, 1)})
                    continue
                dg = max(0, (tmax[i] + tmin[i]) / 2 - base)
                cum += dg
                gdd_vals.append({'date': day, 'gdd': round(dg, 1), 'cumulative': round(cum, 1)})
            result = {'gdd': gdd_vals, 'base_temp': base}
            cache_set(cache_key, result, 3600)
            return jsonify(result)
        return jsonify({'error': 'GDD data unavailable'}), 502
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/ensemble')
def ensemble():
    lat = float(request.args.get('lat', 40.7))
    lng = float(request.args.get('lng', -74.0))
    cache_key = f'ensemble_{lat:.1f}_{lng:.1f}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)
    try:
        import requests as req
        results = {}
        for name, model in [('gfs','gfs_seamless'),('ecmwf','ecmwf_ifs025'),('icon','icon_seamless'),('gem','gem_seamless')]:
            try:
                url = (f'https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lng}'
                       f'&models={model}&hourly=temperature_2m,precipitation,wind_speed_10m'
                       f'&forecast_days=7&timezone=auto')
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
    lat   = float(request.args.get('lat', 40.7))
    lng   = float(request.args.get('lng', -74.0))
    conds_raw = request.args.get('conditions', '[]')
    try:
        conds = json.loads(conds_raw)
    except Exception:
        conds = []
    try:
        import requests as req
        url = (f'https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lng}'
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
                field = cond.get('field', '')
                op    = cond.get('op', '>')
                val   = float(cond.get('value', 0))
                label = cond.get('label', f'{field} {op} {val}')
                cur   = wx.get(field)
                if cur is None: continue
                cur = float(cur)
                match = (op=='>' and cur>val) or (op=='>=' and cur>=val) or \
                        (op=='<' and cur<val) or (op=='<=' and cur<=val) or \
                        (op=='==' and cur==val)
                if match:
                    triggered.append({'label': label, 'field': field, 'current': cur, 'op': op, 'threshold': val})
            except Exception:
                pass
        return jsonify({'triggered': triggered, 'current': wx, 'conditions_checked': len(conds)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/health')
def health():
    return jsonify({
        'status': 'ok',
        'nexradaws': NEXRAD_OK,
        'matplotlib': PLOT_OK,
        'version': '14.0',
    })


if __name__ == '__main__':
    port = int(os.environ.get('RADAR_PORT', 3002))
    log.info(f'Radar microservice v14.0 on :{port}')
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)


@app.route('/api/spc/outlooks')
def spc_outlooks():
    """SPC Convective Outlook polygons (Day 1-3) via NOAA SPC."""
    day = int(request.args.get('day', 1))
    cache_key = f'spc_outlook_day{day}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)
    try:
        import requests as req
        day_str = {1: 'day1otlk', 2: 'day2otlk', 3: 'day3otlk'}.get(day, 'day1otlk')
        url = f'https://www.spc.noaa.gov/products/outlook/archive/2024/{day_str}_20240101_1200.lyr.geojson'
        # Use today's real URL format
        from datetime import datetime
        now = datetime.utcnow()
        date_str = now.strftime('%Y%m%d')
        url = f'https://www.spc.noaa.gov/products/outlook/{day_str}_{date_str}_1200.lyr.geojson'
        r = req.get(url, timeout=8, headers={'User-Agent': 'StormSurgeWeather/14.0'})
        if r.ok:
            data = r.json()
            cache_set(cache_key, data, 1800)
            return jsonify(data)
        # Try latest
        url2 = f'https://www.spc.noaa.gov/products/outlook/{day_str}_latest.lyr.geojson'
        r2 = req.get(url2, timeout=8, headers={'User-Agent': 'StormSurgeWeather/14.0'})
        if r2.ok:
            data = r2.json()
            cache_set(cache_key, data, 1800)
            return jsonify(data)
        return jsonify({'type': 'FeatureCollection', 'features': []}), 200
    except Exception as e:
        return jsonify({'error': str(e), 'type': 'FeatureCollection', 'features': []}), 200


@app.route('/api/watches')
def active_watches():
    """Active tornado/severe thunderstorm watches from SPC."""
    cache_key = 'spc_watches'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)
    try:
        import requests as req
        url = 'https://www.spc.noaa.gov/products/watch/ActiveWW.geojson'
        r = req.get(url, timeout=8, headers={'User-Agent': 'StormSurgeWeather/14.0'})
        if r.ok:
            data = r.json()
            cache_set(cache_key, data, 300)
            return jsonify(data)
        return jsonify({'type': 'FeatureCollection', 'features': []}), 200
    except Exception as e:
        return jsonify({'error': str(e), 'type': 'FeatureCollection', 'features': []}), 200


@app.route('/api/goes/latest')
def goes_latest():
    """Latest GOES-16 satellite imagery URLs from NOAA."""
    sector = request.args.get('sector', 'CONUS')  # CONUS, FULL, AK, HI
    band   = request.args.get('band', 'GEOCOLOR')  # GEOCOLOR, Band02, Band13
    cache_key = f'goes_{sector}_{band}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)
    try:
        # NOAA GOES imagery is available via star.nesdis.noaa.gov
        base = 'https://cdn.star.nesdis.noaa.gov/GOES16/ABI'
        sector_map = {'CONUS': 'CONUS', 'FULL': 'FD', 'AK': 'MESOSCALE-1', 'HI': 'MESOSCALE-2'}
        s = sector_map.get(sector, 'CONUS')
        # Return the latest image URL (these are updated every 5-10 min)
        urls = {
            'latest_1km':  f'{base}/{s}/{band}/latest.jpg',
            'latest_2km':  f'{base}/{s}/{band}/20241001/latest.jpg',
            'sector': sector,
            'band': band,
            'source': 'NOAA GOES-16',
            'note': 'Images update every 5-10 minutes',
        }
        cache_set(cache_key, urls, 300)
        return jsonify(urls)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/freezing_level')
def freezing_level():
    """Estimate freezing level altitude from sounding data."""
    lat = float(request.args.get('lat', 40.7))
    lng = float(request.args.get('lng', -74.0))
    try:
        import requests as req
        url = (f'https://api.open-meteo.com/v1/forecast'
               f'?latitude={lat}&longitude={lng}'
               f'&hourly=freezinglevel_height,temperature_2m,snowfall_height'
               f'&forecast_days=3&timezone=auto')
        r = req.get(url, timeout=8)
        if r.ok:
            d = r.json()
            h = d.get('hourly', {})
            result = {
                'time': h.get('time', [])[:12],
                'freezing_level_m': h.get('freezinglevel_height', [])[:12],
                'snowfall_height_m': h.get('snowfall_height', [])[:12],
                'temp_2m': h.get('temperature_2m', [])[:12],
            }
            return jsonify(result)
        return jsonify({'error': 'Freezing level unavailable'}), 502
    except Exception as e:
        return jsonify({'error': str(e)}), 500
