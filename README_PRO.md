# Storm Surge Weather v14.0 — Pro Setup

## Quick Start
```bash
# 1. Install Python dependencies (one time)
pip install -r requirements.txt

# 2. Start everything
npm start          # starts Node.js server on :3001
python3 radar_service.py   # starts Python radar service on :3002

# Or with electron:
npm run electron   # auto-starts both services
```

## Pro Features (require Python service)
| Feature | Endpoint | Source |
|---------|----------|--------|
| Level II Radar | `/api/radar/level2/render` | AWS S3 + nexradaws + PyART |
| Skew-T Sounding | `/api/radar/skewtdata` | Univ. of Wyoming |
| METAR/TAF | `/api/metar/nearest` | aviationweather.gov |
| Ensemble Models | `/api/ensemble` | Open-Meteo (GFS/ECMWF/ICON/GEM) |
| Tidal Predictions | `/api/tide` | NOAA CO-OPS |
| Pollen Counts | `/api/pollen` | Open-Meteo Air Quality |
| Growing Degree Days | `/api/gdd` | Open-Meteo |
| Custom Alert Logic | `/api/alerts/custom` | Open-Meteo |

## Standard Features (Node.js only, always available)
- RainViewer composite radar
- NWS alerts
- Open-Meteo weather/AQI/marine
- NEXRAD IEM tiles
- Spotter Network (mPing + SPC)
- NWS Social Feed (X/Twitter via server proxy)
- AI Assistant (Claude Haiku)

## NEXRAD Stations
160 hardcoded WSR-88D sites with lat/lng — NEXRAD always works
even if api.weather.gov is down. Also fetches live from AWS S3
via nexradaws for Level II data.

## Environment Variables (.env)
```
MAPBOX_TOKEN=pk.xxx        # your Mapbox token
ANTHROPIC_API_KEY=sk-ant-xxx  # for AI assistant
PORT=3001                  # Node server port
RADAR_PORT=3002            # Python service port
```
