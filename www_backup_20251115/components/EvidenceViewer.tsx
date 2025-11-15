import React, { useState, useEffect, useRef } from 'react';
import type { Highlight } from '../types';

interface EvidenceViewerProps {
    file: File;
    highlights: Highlight[];
    hoveredFinding: number | null;
    onHover: (index: number | null) => void;
}

const EvidenceViewer: React.FC<EvidenceViewerProps> = ({ file, highlights, hoveredFinding, onHover }) => {
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
    const imageRef = useRef<HTMLImageElement>(null);

    useEffect(() => {
        if (file) {
            const url = URL.createObjectURL(file);
            setImageUrl(url);

            return () => URL.revokeObjectURL(url);
        }
    }, [file]);

    const handleImageLoad = () => {
        if (imageRef.current) {
            setImageDimensions({
                width: imageRef.current.offsetWidth,
                height: imageRef.current.offsetHeight,
            });
        }
    };
    
    // Recalculate dimensions on window resize
    useEffect(() => {
        const handleResize = () => {
           if (imageRef.current) {
                setImageDimensions({
                    width: imageRef.current.offsetWidth,
                    height: imageRef.current.offsetHeight,
                });
            }
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    if (!imageUrl) {
        return <div>Loading evidence...</div>;
    }

    return (
        <div className="relative w-full h-full bg-gray-900/50 rounded-md overflow-hidden">
            <img
                ref={imageRef}
                src={imageUrl}
                alt="Evidence document"
                onLoad={handleImageLoad}
                className="w-full h-auto"
            />
            {imageDimensions.width > 0 && highlights.map((highlight) => {
                const { boundingBox, findingIndex } = highlight;
                if (!boundingBox || boundingBox.length < 2) return null;

                const xs = boundingBox.map(v => v.x * imageDimensions.width);
                const ys = boundingBox.map(v => v.y * imageDimensions.height);

                const minX = Math.min(...xs);
                const minY = Math.min(...ys);
                const maxX = Math.max(...xs);
                const maxY = Math.max(...ys);

                const style: React.CSSProperties = {
                    position: 'absolute',
                    left: `${minX}px`,
                    top: `${minY}px`,
                    width: `${maxX - minX}px`,
                    height: `${maxY - minY}px`,
                };
                
                const isHovered = hoveredFinding === findingIndex;

                return (
                    <div
                        key={findingIndex}
                        style={style}
                        className={`transition-all duration-200 border-2 ${isHovered ? 'bg-blue-500/40 border-blue-300' : 'bg-blue-500/20 border-blue-400 border-dashed'} rounded-sm`}
                        onMouseEnter={() => onHover(findingIndex)}
                        onMouseLeave={() => onHover(null)}
                    >
                        <span className={`absolute -top-5 left-0 px-1.5 py-0.5 text-xs font-bold text-white rounded-t-md ${isHovered ? 'bg-blue-400' : 'bg-blue-500'}`}>{findingIndex}</span>
                    </div>
                );
            })}
        </div>
    );
};

export default EvidenceViewer;
