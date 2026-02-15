import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import stationData from './stations.json';
import tracks from './tracks.json';
import { SearchBox } from './SearchBox.tsx';
import { HomeIcon } from '@heroicons/react/24/outline';
import { computeFastestRoute, type Station, type Track } from './routing';
import { TrackBuilderPanel } from './developer/TrackBuilderPanel';
import { initializeTrackBuilderLayers, useTrackBuilder } from './developer/useTrackBuilder';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '';

const stations: Station[] = stationData as Station[];
const initialTracks: Track[] = tracks as Track[];
const IS_DEV_BUILD = import.meta.env.DEV;

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

function createEmptyFeatureCollection(): GeoJSON.FeatureCollection {
    return {
        type: 'FeatureCollection',
        features: []
    };
}

export default function Map() {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);

    const [routeDisplay, setRouteDisplay] = useState<RouteDisplay | null>(null);
    const [routeError, setRouteError] = useState<string | null>(null);
    const [mapLoaded, setMapLoaded] = useState(false);
    const [isDeveloperMode, setIsDeveloperMode] = useState(false);
    const [networkTracks, setNetworkTracks] = useState<Track[]>(() => initialTracks);

    const stationsById = useMemo(
        () => new globalThis.Map(stations.map((station) => [station.id, station])),
        []
    );

    const {
        draftTrack,
        savedDraftTracks,
        copyMessage,
        editingTrackIndex,
        selectedTrackDeleteIndex,
        currentDraftTrackObject,
        canUndo,
        canRedo,
        draftStartStation,
        draftEndStation,
        handleStationClick,
        resetDraftTrack,
        saveDraftTrack,
        copyCurrentJson,
        copySavedJson,
        appendSavedTracksToFile,
    } = useTrackBuilder({
        isDevBuild: IS_DEV_BUILD,
        isDeveloperMode,
        map,
        mapLoaded,
        networkTracks,
        stationsById,
        setNetworkTracks,
    });

    useEffect(() => {
        if (map.current) return;
        if (!mapContainer.current) return;

        map.current = new mapboxgl.Map({
            container: mapContainer.current,
            style: 'mapbox://styles/mapbox/light-v11',
            projection: 'mercator',
            center: DEFAULT_CENTER,
            zoom: DEFAULT_ZOOM,
        });

        stations.forEach((station) => {
            const popup = new mapboxgl.Popup().setText(station.name);
            const markerElement = document.createElement('button');
            markerElement.type = 'button';
            markerElement.className = 'w-3 h-3 rounded-full border border-white bg-blue-700 shadow';
            markerElement.title = station.name;

            markerElement.addEventListener('click', (event) => {
                event.stopPropagation();
                handleStationClick(station.id);
            });

            new mapboxgl.Marker({ element: markerElement })
                .setLngLat(station.lngLat as [number, number])
                .setPopup(popup)
                .addTo(map.current as mapboxgl.Map);
        });

        map.current.on('load', () => {
            if (!map.current) return;

            map.current.addSource('tracks', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: initialTracks.map(({ endpoints, coordinates }, index) => ({
                        type: 'Feature' as const,
                        properties: { id: `${endpoints[0]}:${endpoints[1]}`, index },
                        geometry: {
                            type: 'LineString' as const,
                            coordinates
                        }
                    }))
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

            map.current.addSource('track-delete-selection', {
                type: 'geojson',
                data: createEmptyFeatureCollection()
            });

            map.current.addLayer({
                id: 'track-delete-selection',
                type: 'line',
                source: 'track-delete-selection',
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': '#dc2626',
                    'line-width': 8
                }
            });

            map.current.addSource('route-path', {
                type: 'geojson',
                data: createEmptyFeatureCollection()
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

            initializeTrackBuilderLayers(map.current);
            setMapLoaded(true);
        });
    }, [handleStationClick]);

    useEffect(() => {
        if (!map.current || !mapLoaded) return;
        const tracksSource = map.current.getSource('tracks') as mapboxgl.GeoJSONSource | undefined;
        if (!tracksSource) return;

        tracksSource.setData({
            type: 'FeatureCollection',
            features: networkTracks.map(({ endpoints, coordinates }, index) => ({
                type: 'Feature' as const,
                properties: { id: `${endpoints[0]}:${endpoints[1]}`, index },
                geometry: {
                    type: 'LineString' as const,
                    coordinates
                }
            }))
        });
    }, [mapLoaded, networkTracks]);

    useEffect(() => {
        if (!map.current || !mapLoaded) return;
        const deleteSelectionSource = map.current.getSource('track-delete-selection') as mapboxgl.GeoJSONSource | undefined;
        if (!deleteSelectionSource) return;

        const selectedTrack = selectedTrackDeleteIndex !== null
            ? networkTracks[selectedTrackDeleteIndex]
            : undefined;

        deleteSelectionSource.setData({
            type: 'FeatureCollection',
            features: selectedTrack
                ? [{
                    type: 'Feature',
                    properties: {},
                    geometry: {
                        type: 'LineString',
                        coordinates: selectedTrack.coordinates
                    }
                }]
                : []
        });
    }, [mapLoaded, networkTracks, selectedTrackDeleteIndex]);

    const handleSearch = (from: number, to: number) => {
        const fromStation = stationsById.get(from);
        const toStation = stationsById.get(to);
        const route = computeFastestRoute(from, to, networkTracks);

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
            {IS_DEV_BUILD && (
                <button
                    onClick={() => setIsDeveloperMode((previous) => !previous)}
                    className={`absolute top-4 right-20 z-50 rounded px-3 py-2 text-sm shadow-md border ${
                        isDeveloperMode
                            ? 'bg-amber-500 text-white border-amber-600'
                            : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'
                    }`}
                    title="Toggle track builder mode"
                >
                    {isDeveloperMode ? 'Exit Dev Mode' : 'Developer Mode'}
                </button>
            )}
            <div className="absolute top-4 right-4 z-50">
                <button
                    onClick={handleHome}
                    className="bg-white p-2 rounded shadow-md hover:bg-gray-100 flex items-center justify-center"
                    title="Reset map to default view"
                >
                    <HomeIcon className="h-5 w-5" />
                </button>
            </div>
            {IS_DEV_BUILD && isDeveloperMode && (
                <TrackBuilderPanel
                    draftStartStation={draftStartStation}
                    draftEndStation={draftEndStation}
                    viaPointCount={draftTrack.viaPoints.length}
                    currentDraftTrackObject={currentDraftTrackObject}
                    savedDraftTracks={savedDraftTracks}
                    copyMessage={copyMessage}
                    isEditingExistingTrack={editingTrackIndex !== null}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    onResetDraft={resetDraftTrack}
                    onSaveTrack={saveDraftTrack}
                    onCopyCurrentJson={copyCurrentJson}
                    onCopySavedJson={copySavedJson}
                    onAppendSaved={appendSavedTracksToFile}
                />
            )}
            <div ref={mapContainer} className="w-full h-screen" />
        </div>
    );
}
