import { useRef, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import stationData from './stations.json';
import tracks from './tracks.json';
import { SearchBox } from './SearchBox.tsx';
import { HomeIcon } from '@heroicons/react/24/outline';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '';


interface Station {
    id: number;
    name: string;
    IATA: string;
    lngLat: [number, number];
}

const stations: Station[] = stationData as Station[];

interface Track {
    endpoints: [number, number],
    coordinates: [[number, number]]
}

export default function Map() {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);

    useEffect(() => {
        if (map.current) return; // initialize map only once
        if (mapContainer.current) {
            map.current = new mapboxgl.Map({
                container: mapContainer.current,
                style: 'mapbox://styles/mapbox/light-v11',
                projection: 'mercator',
                // Center Map on US
                center: [-95.3521, 38.3969],
                zoom: 4.25,
            });

            (stations).forEach(({ name, lngLat }) => {
                const popup = new mapboxgl.Popup().setText(name);

                new mapboxgl.Marker({})
                    .setLngLat(lngLat as [number, number])
                    .setPopup(popup)
                    .addTo(map.current as mapboxgl.Map)
            });

            map.current.on('load', () => {
                (tracks as Track[]).forEach(({ endpoints, coordinates }) => {
                    const track_id = 'track' + endpoints[0] + '.' + endpoints[1];
                    // console.log(track_id);
                    // IF Statements prevent TS error: map.current possibly null
                    if (map.current) {
                        map.current.addSource(track_id, {
                            'type': 'geojson',
                            'data': {
                                'type': 'Feature',
                                'properties': {},
                                'geometry': {
                                    'type': 'LineString',
                                    'coordinates': coordinates
                                }
                            }
                        });
                    }
                    if (map.current) {
                        map.current.addLayer({
                            'id': track_id,
                            'type': 'line',
                            'source': track_id,
                            'layout': {
                                'line-join': 'round',
                                'line-cap': 'round'
                            },
                            'paint': {
                                'line-color': '#5b8fe3',
                                'line-width': 5
                            }
                        });
                    }
                });
            });
        }
    }, []);

    const handleSearch = (from: number, to: number) => {
        const fromStation = stations.find(s => s.id === from);
        const toStation = stations.find(s => s.id === to);
        
        if (fromStation && toStation) {
            // Calculate bounding box
            const bounds = new mapboxgl.LngLatBounds(
                fromStation.lngLat,
                toStation.lngLat
            );
            
            // Add some padding to the bounds
            const padding = {
                top: 100,
                bottom: 100,
                left: 100,
                right: 100
            };
            
            // Fit map to bounds with padding
            if (map.current) {
                map.current.fitBounds(bounds, { padding });
            }
        }
    };


    const handleHome = () => {
        if (map.current) {
            map.current.flyTo({
                center: [-95.3521, 38.3969],
                zoom: 4.25,
                pitch: 0,
                bearing: 0,
                duration: 1000
            });
        }
    };

    return (
        <div className="relative">
            <SearchBox onSearch={handleSearch} stations={stations} />
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