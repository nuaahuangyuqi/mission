import { jsPDF } from 'jspdf';

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function captureViewerDataUrl(viewer) {
  viewer.render();
  return viewer.scene.canvas.toDataURL('image/png');
}

export function exportKml(entities, filename = 'situation.kml') {
  const placemarks = entities.map((entity) => {
    if (entity.geometryType === 'point') {
      const [lon, lat] = entity.coordinates;
      return `
        <Placemark>
          <name>${entity.name}</name>
          <description>${entity.annotation || ''}</description>
          <Point><coordinates>${lon},${lat},0</coordinates></Point>
        </Placemark>`;
    }

    if (entity.geometryType === 'polyline') {
      const coordinates = entity.coordinates.map((point) => `${point[0]},${point[1]},0`).join(' ');
      return `
        <Placemark>
          <name>${entity.name}</name>
          <description>${entity.annotation || ''}</description>
          <LineString><coordinates>${coordinates}</coordinates></LineString>
        </Placemark>`;
    }

    if (entity.geometryType === 'polygon') {
      const coordinates = [...entity.coordinates, entity.coordinates[0]]
        .map((point) => `${point[0]},${point[1]},0`)
        .join(' ');
      return `
        <Placemark>
          <name>${entity.name}</name>
          <description>${entity.annotation || ''}</description>
          <Polygon><outerBoundaryIs><LinearRing><coordinates>${coordinates}</coordinates></LinearRing></outerBoundaryIs></Polygon>
        </Placemark>`;
    }

    if (entity.geometryType === 'circle') {
      const [lon, lat] = entity.coordinates;
      const earthRadius = 6378137;
      const points = Array.from({ length: 48 }, (_, index) => {
        const angle = (index / 48) * Math.PI * 2;
        const dx = (entity.radius / earthRadius) * Math.cos(angle);
        const dy = (entity.radius / earthRadius) * Math.sin(angle);
        const newLat = lat + (dy * 180) / Math.PI;
        const newLon = lon + ((dx * 180) / Math.PI) / Math.cos((lat * Math.PI) / 180);
        return `${newLon},${newLat},0`;
      }).join(' ');

      return `
        <Placemark>
          <name>${entity.name}</name>
          <description>${entity.annotation || ''}</description>
          <Polygon><outerBoundaryIs><LinearRing><coordinates>${points}</coordinates></LinearRing></outerBoundaryIs></Polygon>
        </Placemark>`;
    }

    return '';
  }).join('');

  const content = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document>
        ${placemarks}
      </Document>
    </kml>`;

  downloadBlob(new Blob([content], { type: 'application/vnd.google-earth.kml+xml' }), filename);
}

export async function exportViewerToPng(viewer, filename = 'situation.png') {
  const dataUrl = await captureViewerDataUrl(viewer);
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  downloadBlob(blob, filename);
  return dataUrl;
}

export async function exportViewerToPdf(viewer, filename = 'situation.pdf') {
  const dataUrl = await captureViewerDataUrl(viewer);
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [1280, 720] });
  pdf.addImage(dataUrl, 'PNG', 24, 24, 1232, 672);
  pdf.save(filename);
}
