import { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';

mapboxgl.accessToken = 'pk.eyJ1IjoibmFuZGFucyIsImEiOiJjbHlncW1odzgwZTJjMmlwbjIyOXY1MTQyIn0.q1xnoWyi9HUOqUppVZ2--w';

export default function App() {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const [lng, setLng] = useState(-95.3521);
    const [lat, setLat] = useState(38.3969);
    const [zoom, setZoom] = useState(3.69);

    useEffect(() => {
        if (map.current) return; // initialize map only once
        if (mapContainer.current) {
            map.current = new mapboxgl.Map({
                container: mapContainer.current,
                style: 'mapbox://styles/mapbox/light-v10',
                center: [lng, lat],
                zoom: zoom
            });
        }
    }, []);

    useEffect(() => {
        if (!map.current) return; // wait for map to initialize
        map.current.on('move', () => {
            const center = map.current!.getCenter();
            setLng(Number(center.lng.toFixed(2)));
            setLat(Number(center.lat.toFixed(2)));
            setZoom(Number(map.current!.getZoom().toFixed(2)));
        });
    }, []);

    return (
        <div className="relative">
            <div className="absolute top-0 left-0 m-3 p-3 z-10 bg-[rgb(35,55,75)] bg-opacity-90 text-white font-mono rounded">
                Longitude: {lng} | Latitude: {lat} | Zoom: {zoom}
            </div>
            <div ref={mapContainer} className="w-full h-screen" />
        </div>
    );
}