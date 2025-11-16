type Jurisdiction = 'UAE' | 'KSA' | 'EU' | 'US' | 'ZA' | 'UN';

function guessJurisdiction(lat: number, lon: number): Jurisdiction {
  if (lat < -20 && lat > -36 && lon > 16 && lon < 33) return 'ZA';
  if (lat > 35 && lat < 72 && lon > -25 && lon < 45) return 'EU';
  if (lat > 22 && lat < 27.5 && lon > 51 && lon < 56.5) return 'UAE';
  if (lat > 16 && lat < 32.5 && lon > 34 && lon < 56) return 'KSA';
  if (lat > 24 && lat < 49 && lon > -125 && lon < -66) return 'US';
  return 'UN';
}

export async function getJurisdictionFromGeolocation(): Promise<Jurisdiction> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve('UN');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        resolve(guessJurisdiction(latitude, longitude));
      },
      () => resolve('UN'),
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 }
    );
  });
}
