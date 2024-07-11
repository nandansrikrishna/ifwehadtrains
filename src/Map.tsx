import { useRef, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import stations from './stations.json';

mapboxgl.accessToken = 'pk.eyJ1IjoibmFuZGFucyIsImEiOiJjbHlncW1odzgwZTJjMmlwbjIyOXY1MTQyIn0.q1xnoWyi9HUOqUppVZ2--w';

interface Station {
    name: string;
    lngLat: [number, number]
}

export default function Map() {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);

    useEffect(() => {
        if (map.current) return; // initialize map only once
        if (mapContainer.current) {
            map.current = new mapboxgl.Map({
                container: mapContainer.current,
                style: 'mapbox://styles/mapbox/light-v10',
                // Center Map on US
                center: [-95.3521, 38.3969],
                zoom: 3.69
            });

            (stations as Station[]).forEach(({ name, lngLat }) => {
                const popup = new mapboxgl.Popup().setText(name);
                
                new mapboxgl.Marker({})
                    .setLngLat(lngLat as [number, number])
                    .setPopup(popup)
                    .addTo(map.current as mapboxgl.Map)
            });

            // const popup = new mapboxgl.Popup({ offset: 25 }).setText(
            //     'Train Station'
            // );

            // new mapboxgl.Marker({
            //     color: '#4287f5',
            //     scale: 1
            // })
            //     .setLngLat([-95, 38])
            //     .setPopup(popup)
            //     .addTo(map.current)
        }
    }, []);

    return (
        <div className="relative">
            <div ref={mapContainer} className="w-full h-screen" />
        </div>
    );
}