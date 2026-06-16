-- Store OpenStreetMap-picked coordinates for registered business address (Time punch geofencing).

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS registered_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS registered_longitude DOUBLE PRECISION;

COMMENT ON COLUMN tenants.registered_latitude IS 'Latitude from OSM address search for geofencing sync.';
COMMENT ON COLUMN tenants.registered_longitude IS 'Longitude from OSM address search for geofencing sync.';
