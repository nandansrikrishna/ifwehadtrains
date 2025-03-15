import { useRef, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import stationData from './stations.json';
import tracks from './tracks.json';
import { SearchBox } from './SearchBox.tsx';

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
                zoom: 3.69,
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
        console.log('Searching route from station ID:', from, 'to station ID:', to);
    };


    return (
        <div className="relative">
            <SearchBox onSearch={handleSearch} stations={stations} />
            <div ref={mapContainer} className="w-full h-screen" />
        </div>
    );
}