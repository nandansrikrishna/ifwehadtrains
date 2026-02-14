import { useRef, useEffect, useMemo, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import stationData from './stations.json';
import tracks from './tracks.json';
import { SearchBox } from './SearchBox.tsx';
import { HomeIcon } from '@heroicons/react/24/outline';
import { computeFastestRoute, type Station, type Track } from './routing';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '';

const stations: Station[] = stationData as Station[];
const trackData: Track[] = tracks as Track[];

interface RouteDisplay {
    stationNames: string[];
    totalMinutes: number;
}

const DEFAULT_CENTER: [number, number] = [-95.3521, 38.3969];
const DEFAULT_ZOOM = 4.25;

function formatDuration(totalMinutes: number): string {
    const rounded = Math.round(totalMinutes);
    const hours = Math.floor(rounded / 60);
    const minutes = rounded % 60;

    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
}

export default function Map() {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const [routeDisplay, setRouteDisplay] = useState<RouteDisplay | null>(null);
    const [routeError, setRouteError] = useState<string | null>(null);

    const stationsById = useMemo(
        () => new globalThis.Map(stations.map((station) => [station.id, station])),
        []
    );

    useEffect(() => {
        if (map.current) return; // initialize map only once
        if (mapContainer.current) {
            map.current = new mapboxgl.Map({
                container: mapContainer.current,
                style: 'mapbox://styles/mapbox/light-v11',
                projection: 'mercator',
                // Center Map on US
                center: DEFAULT_CENTER,
                zoom: DEFAULT_ZOOM,
            });

            stations.forEach(({ name, lngLat }) => {
                const popup = new mapboxgl.Popup().setText(name);

                new mapboxgl.Marker({})
                    .setLngLat(lngLat as [number, number])
                    .setPopup(popup)
                    .addTo(map.current as mapboxgl.Map)
            });

            map.current.on('load', () => {
                if (!map.current) return;

                const trackFeatures = trackData.map(({ endpoints, coordinates }) => ({
                    type: 'Feature' as const,
                    properties: {
                        id: `${endpoints[0]}:${endpoints[1]}`
                    },
                    geometry: {
                        type: 'LineString' as const,
                        coordinates
                    }
                }));

                map.current.addSource('tracks', {
                    type: 'geojson',
                    data: {
                        type: 'FeatureCollection',
                        features: trackFeatures
                    }
                });

                map.current.addLayer({
                    id: 'tracks-base',
                    type: 'line',
                    source: 'tracks',
                    layout: {
                        'line-join': 'round',
                        'line-cap': 'round'
                    },
                    paint: {
                        'line-color': '#5b8fe3',
                        'line-width': 5
                    }
                });

                map.current.addSource('route-path', {
                    type: 'geojson',
                    data: {
                        type: 'FeatureCollection',
                        features: []
                    }
                });

                map.current.addLayer({
                    id: 'route-highlight',
                    type: 'line',
                    source: 'route-path',
                    layout: {
                        'line-join': 'round',
                        'line-cap': 'round'
                    },
                    paint: {
                        'line-color': '#e24a33',
                        'line-width': 7
                    }
                });
            });
        }
    }, [stationsById]);

    const handleSearch = (from: number, to: number) => {
        const fromStation = stationsById.get(from);
        const toStation = stationsById.get(to);
        const route = computeFastestRoute(from, to, trackData);

        if (!fromStation || !toStation) {
            setRouteError('Invalid station selection.');
            setRouteDisplay(null);
            return;
        }

        if (!route) {
            setRouteError(`No connected route found between ${fromStation.name} and ${toStation.name}.`);
            setRouteDisplay(null);

            if (map.current) {
                const routeSource = map.current.getSource('route-path') as mapboxgl.GeoJSONSource | undefined;
                routeSource?.setData({
                    type: 'FeatureCollection',
                    features: []
                });
            }
            return;
        }

        setRouteError(null);
        setRouteDisplay({
            stationNames: route.pathStationIds
                .map((id) => stationsById.get(id)?.name)
                .filter((name): name is string => Boolean(name)),
            totalMinutes: route.totalMinutes,
        });

        if (map.current) {
            const routeSource = map.current.getSource('route-path') as mapboxgl.GeoJSONSource | undefined;
            routeSource?.setData({
                type: 'FeatureCollection',
                features: route.pathCoordinates.length > 1
                    ? [{
                        type: 'Feature',
                        properties: {},
                        geometry: {
                            type: 'LineString',
                            coordinates: route.pathCoordinates
                        }
                    }]
                    : []
            });

            const bounds = new mapboxgl.LngLatBounds();
            if (route.pathCoordinates.length > 1) {
                route.pathCoordinates.forEach((coordinate) => bounds.extend(coordinate));
            } else {
                bounds.extend(fromStation.lngLat);
                bounds.extend(toStation.lngLat);
            }

            map.current.fitBounds(bounds, {
                padding: { top: 110, bottom: 110, left: 110, right: 110 },
                maxZoom: 8
            });
        }
    };

    const handleHome = () => {
        setRouteDisplay(null);
        setRouteError(null);

        if (map.current) {
            const routeSource = map.current.getSource('route-path') as mapboxgl.GeoJSONSource | undefined;
            routeSource?.setData({
                type: 'FeatureCollection',
                features: []
            });

            map.current.flyTo({
                center: DEFAULT_CENTER,
                zoom: DEFAULT_ZOOM,
                pitch: 0,
                bearing: 0,
                duration: 1000
            });
        }
    };

    return (
        <div className="relative">
            <SearchBox onSearch={handleSearch} stations={stations} />
            <div className="absolute top-4 left-64 z-20 max-w-md bg-white/95 p-3 rounded shadow-md border border-gray-200">
                {routeError && (
                    <p className="text-sm text-red-700">{routeError}</p>
                )}
                {!routeError && routeDisplay && (
                    <div className="text-sm text-gray-800">
                        <p className="font-semibold">
                            Estimated travel time: {formatDuration(routeDisplay.totalMinutes)}
                        </p>
                        <p className="mt-1">
                            Route: {routeDisplay.stationNames.join(' -> ')}
                        </p>
                    </div>
                )}
                {!routeError && !routeDisplay && (
                    <p className="text-sm text-gray-600">
                        Select two stations to compute the fastest route.
                    </p>
                )}
            </div>
            <div className="absolute top-4 right-4 z-50">
                <button 
                    onClick={handleHome}
                    className="bg-white p-2 rounded shadow-md hover:bg-gray-100 flex items-center justify-center"
                    title="Reset map to default view"
                >
                    <HomeIcon className="h-5 w-5" />
                </button>
            </div>
            <div ref={mapContainer} className="w-full h-screen" />
        </div>
    );
}
