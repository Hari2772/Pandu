/**
 * Location utilities for NearChat
 * Privacy-first approach: Never expose exact coordinates to other users
 */

// Earth's radius in meters
const EARTH_RADIUS = 6371000;

/**
 * Calculate distance between two points using Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number} Distance in meters
 */
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  try {
    // Convert degrees to radians
    const lat1Rad = (lat1 * Math.PI) / 180;
    const lon1Rad = (lon1 * Math.PI) / 180;
    const lat2Rad = (lat2 * Math.PI) / 180;
    const lon2Rad = (lon2 * Math.PI) / 180;

    // Haversine formula
    const dLat = lat2Rad - lat1Rad;
    const dLon = lon2Rad - lon1Rad;
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1Rad) * Math.cos(lat2Rad) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = EARTH_RADIUS * c;

    return Math.round(distance);
  } catch (error) {
    console.error('Error calculating distance:', error);
    return 0;
  }
};

/**
 * Get distance tier based on distance in meters
 * @param {number} distanceInMeters - Distance in meters
 * @returns {Object} Distance tier information
 */
const getDistanceTier = (distanceInMeters) => {
  if (distanceInMeters <= 3000) {
    return {
      tier: 'near',
      color: 'green',
      range: '1m - 3km',
      description: 'Very Close'
    };
  } else if (distanceInMeters <= 10000) {
    return {
      tier: 'medium',
      color: 'blue',
      range: '3km - 10km',
      description: 'Close'
    };
  } else if (distanceInMeters <= 80000) {
    return {
      tier: 'far',
      color: 'orange',
      range: '10km - 80km',
      description: 'Far'
    };
  } else {
    return {
      tier: 'very_far',
      color: 'gray',
      range: '80km+',
      description: 'Very Far'
    };
  }
};

/**
 * Format distance for display
 * @param {number} distanceInMeters - Distance in meters
 * @returns {string} Formatted distance string
 */
const formatDistance = (distanceInMeters) => {
  if (distanceInMeters < 1000) {
    return `${distanceInMeters}m`;
  } else if (distanceInMeters < 10000) {
    return `${(distanceInMeters / 1000).toFixed(1)}km`;
  } else {
    return `${Math.round(distanceInMeters / 1000)}km`;
  }
};

/**
 * Validate coordinates
 * @param {number} latitude - Latitude
 * @param {number} longitude - Longitude
 * @returns {boolean} True if coordinates are valid
 */
const validateCoordinates = (latitude, longitude) => {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
};

/**
 * Calculate bounding box for a point and radius
 * @param {number} lat - Latitude of center point
 * @param {number} lon - Longitude of center point
 * @param {number} radiusInMeters - Radius in meters
 * @returns {Object} Bounding box coordinates
 */
const calculateBoundingBox = (lat, lon, radiusInMeters) => {
  const latDelta = (radiusInMeters / EARTH_RADIUS) * (180 / Math.PI);
  const lonDelta = (radiusInMeters / EARTH_RADIUS) * (180 / Math.PI) / Math.cos(lat * Math.PI / 180);

  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLon: lon - lonDelta,
    maxLon: lon + lonDelta
  };
};

/**
 * Check if a point is within a radius of another point
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @param {number} radiusInMeters - Radius in meters
 * @returns {boolean} True if point is within radius
 */
const isWithinRadius = (lat1, lon1, lat2, lon2, radiusInMeters) => {
  const distance = calculateDistance(lat1, lon1, lat2, lon2);
  return distance <= radiusInMeters;
};

/**
 * Get privacy-safe location data (no exact coordinates)
 * @param {Object} location - Location object with coordinates
 * @param {number} userLat - User's latitude
 * @param {number} userLon - User's longitude
 * @returns {Object} Privacy-safe location data
 */
const getPrivacySafeLocation = (location, userLat, userLon) => {
  if (!location || !location.coordinates || !userLat || !userLon) {
    return {
      distance: null,
      distanceTier: null,
      formattedDistance: null,
      isNearby: false
    };
  }

  const distance = calculateDistance(
    userLat, userLon,
    location.coordinates[1], location.coordinates[0]
  );

  const distanceTier = getDistanceTier(distance);
  const formattedDistance = formatDistance(distance);

  return {
    distance,
    distanceTier,
    formattedDistance,
    isNearby: distance <= 50000 // 50km
  };
};

/**
 * Calculate approximate location from distance and bearing
 * @param {number} lat - Starting latitude
 * @param {number} lon - Starting longitude
 * @param {number} distanceInMeters - Distance in meters
 * @param {number} bearingInDegrees - Bearing in degrees
 * @returns {Object} Approximate coordinates
 */
const calculateApproximateLocation = (lat, lon, distanceInMeters, bearingInDegrees) => {
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const bearing = (bearingInDegrees * Math.PI) / 180;
  const angularDistance = distanceInMeters / EARTH_RADIUS;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );

  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
  );

  return {
    latitude: (lat2 * 180) / Math.PI,
    longitude: (lon2 * 180) / Math.PI
  };
};

/**
 * Get location-based timezone offset
 * @param {number} latitude - Latitude
 * @param {number} longitude - Longitude
 * @returns {number} Timezone offset in hours
 */
const getTimezoneOffset = (latitude, longitude) => {
  // Simplified timezone calculation based on longitude
  // In a real implementation, you'd use a timezone database
  const timezoneOffset = Math.round(longitude / 15);
  return Math.max(-12, Math.min(12, timezoneOffset));
};

/**
 * Calculate travel time estimate (simplified)
 * @param {number} distanceInMeters - Distance in meters
 * @param {string} mode - Travel mode ('walking', 'driving', 'transit')
 * @returns {Object} Travel time estimate
 */
const calculateTravelTime = (distanceInMeters, mode = 'driving') => {
  const speeds = {
    walking: 1.4, // m/s (5 km/h)
    driving: 13.9, // m/s (50 km/h average)
    transit: 8.3 // m/s (30 km/h average)
  };

  const speed = speeds[mode] || speeds.driving;
  const timeInSeconds = distanceInMeters / speed;
  const timeInMinutes = Math.round(timeInSeconds / 60);

  return {
    timeInMinutes,
    timeInHours: Math.round((timeInMinutes / 60) * 10) / 10,
    mode,
    formatted: timeInMinutes < 60 
      ? `${timeInMinutes} min`
      : `${Math.round(timeInMinutes / 60)}h ${timeInMinutes % 60}min`
  };
};

/**
 * Generate location hash for privacy
 * @param {number} latitude - Latitude
 * @param {number} longitude - Longitude
 * @param {number} precision - Precision in decimal places (default: 2)
 * @returns {string} Location hash
 */
const generateLocationHash = (latitude, longitude, precision = 2) => {
  const latRounded = Math.round(latitude * Math.pow(10, precision)) / Math.pow(10, precision);
  const lonRounded = Math.round(longitude * Math.pow(10, precision)) / Math.pow(10, precision);
  
  return `${latRounded},${lonRounded}`;
};

/**
 * Check if location is in a specific country (simplified)
 * @param {number} latitude - Latitude
 * @param {number} longitude - Longitude
 * @returns {string|null} Country code or null
 */
const getCountryFromCoordinates = (latitude, longitude) => {
  // This is a simplified implementation
  // In production, you'd use a geocoding service or database
  
  // Example: Rough boundaries for some countries
  const countries = [
    { code: 'US', bounds: { minLat: 24, maxLat: 71, minLon: -180, maxLon: -66 } },
    { code: 'CA', bounds: { minLat: 41, maxLat: 84, minLon: -141, maxLon: -52 } },
    { code: 'GB', bounds: { minLat: 49, maxLat: 61, minLon: -8, maxLon: 2 } },
    { code: 'IN', bounds: { minLat: 6, maxLat: 37, minLon: 68, maxLon: 97 } }
  ];

  for (const country of countries) {
    const bounds = country.bounds;
    if (latitude >= bounds.minLat && latitude <= bounds.maxLat &&
        longitude >= bounds.minLon && longitude <= bounds.maxLon) {
      return country.code;
    }
  }

  return null;
};

module.exports = {
  calculateDistance,
  getDistanceTier,
  formatDistance,
  validateCoordinates,
  calculateBoundingBox,
  isWithinRadius,
  getPrivacySafeLocation,
  calculateApproximateLocation,
  getTimezoneOffset,
  calculateTravelTime,
  generateLocationHash,
  getCountryFromCoordinates
};