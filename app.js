document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const authScreen = document.getElementById('auth-screen');
    const mainScreen = document.getElementById('main-screen');
    const roleBtns = document.querySelectorAll('.role-btn');
    const loginForm = document.getElementById('login-form');
    const userDashboard = document.getElementById('user-dashboard');
    const driverDashboard = document.getElementById('driver-dashboard');
    const logoutBtns = document.querySelectorAll('.logout-btn');

    // User Elements
    const pickupInput = document.getElementById('pickup');
    const dropoffInput = document.getElementById('dropoff');
    const calculateBtn = document.getElementById('calculate-btn');
    const vehicleOptions = document.getElementById('vehicle-options');
    const vehicleCards = document.querySelectorAll('.vehicle-card');
    const selectedVehicleName = document.getElementById('selected-vehicle-name');
    const bookBtn = document.getElementById('book-btn');
    const bookingForm = document.getElementById('booking-form');
    const rideStatusUser = document.getElementById('ride-status-user');
    const userStatusText = document.getElementById('user-status-text');
    const userProgress = document.getElementById('user-progress');
    const payBtn = document.getElementById('pay-btn');
    const finalFareAmount = document.getElementById('final-fare-amount');

    // Driver Elements
    const incomingRequests = document.getElementById('incoming-requests');
    const driverIdle = document.getElementById('driver-idle');
    const driverActive = document.getElementById('driver-active');
    const driverStatusText = document.getElementById('driver-status-text');
    const arriveBtn = document.getElementById('arrive-btn');
    const startRideBtn = document.getElementById('start-ride-btn');
    const completeRideBtn = document.getElementById('complete-ride-btn');

    // State
    let currentUserRole = 'user';
    let map = null;
    let markers = []; // Basic map markers
    let routeLine = null;
    let currentRide = null;
    let userLocation = [28.6139, 77.2090]; // Default Delhi
    let estimatedDistanceKm = 0;
    let selectedVehicleData = { type: 'car', icon: '🚗', name: 'Prime Sedan', fare: 0 };
    
    // Idle & Active Tracking
    let idleDrivers = [];
    let activeDriverState = { marker: null, isAnimating: false };

    // Utils
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // --- API Integrations (Nominatim Geocoding & OSRM Routing) ---
    async function geocode(query) {
        if (!query) return null;
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
            const data = await res.json();
            if (data && data.length > 0) {
                return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), name: data[0].display_name };
            }
        } catch(e) { console.error("Geocoding failed", e); }
        return null;
    }

    async function getRoute(startLatLng, endLatLng) {
        // OSRM expects lon,lat
        const url = `https://router.project-osrm.org/route/v1/driving/${startLatLng[1]},${startLatLng[0]};${endLatLng[1]},${endLatLng[0]}?overview=full&geometries=geojson`;
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (data.code === 'Ok' && data.routes.length > 0) {
                // geojson is [lon, lat], convert to [lat, lon]
                const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
                return {
                    coordinates: coords,
                    distance: data.routes[0].distance, // meters
                    duration: data.routes[0].duration
                };
            }
        } catch (e) { console.error("Routing failed", e); }
        return null;
    }

    async function snapToRoad(latlng) {
        const url = `https://router.project-osrm.org/nearest/v1/driving/${latlng[1]},${latlng[0]}`;
        try {
            const res = await fetch(url);
            const data = await res.json();
            if (data.code === 'Ok' && data.waypoints.length > 0) {
                return [data.waypoints[0].location[1], data.waypoints[0].location[0]];
            }
        } catch(e) {}
        return latlng;
    }

    // --- Auth & Location Logic ---
    roleBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            roleBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentUserRole = e.target.dataset.role;
        });
    });

    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        login();
    });

    logoutBtns.forEach(btn => {
        btn.addEventListener('click', logout);
    });

    function login() {
        authScreen.classList.remove('active');
        mainScreen.classList.add('active');
        
        setTimeout(() => {
            initMap();
            if (currentUserRole === 'user') {
                askForLocation();
            } else {
                updateMapCenter(); 
                listenForRequests();
            }
        }, 100);

        if (currentUserRole === 'user') {
            userDashboard.classList.remove('hidden');
            bookingForm.classList.add('active');
            rideStatusUser.classList.add('hidden');
        } else {
            driverDashboard.classList.remove('hidden');
            driverIdle.classList.add('active');
            driverActive.classList.add('hidden');
        }
    }

    function logout() {
        mainScreen.classList.remove('active');
        authScreen.classList.add('active');
        userDashboard.classList.add('hidden');
        driverDashboard.classList.add('hidden');
        if (map) { map.remove(); map = null; }
        localStorage.removeItem('rideRequest');
        window.removeEventListener('storage', handleStorageEvent);
        clearIdleDrivers();
        clearActiveDriver();
    }

    function initMap() {
        if (map) return;
        map = L.map('map-container', { zoomControl: false }).setView(userLocation, 14);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            subdomains: 'abcd', maxZoom: 20
        }).addTo(map);
        L.control.zoom({ position: 'topright' }).addTo(map);
    }

    function askForLocation() {
        pickupInput.value = "Locating you...";
        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition((position) => {
                userLocation = [position.coords.latitude, position.coords.longitude];
                pickupInput.value = "My Current Location";
                updateMapCenter();
            }, () => {
                pickupInput.value = "";
                pickupInput.placeholder = "Enter Pickup Location (e.g., Connaught Place)";
                updateMapCenter();
            }, { timeout: 5000 });
        } else {
            pickupInput.value = "";
            pickupInput.placeholder = "Enter Pickup Location";
            updateMapCenter();
        }
    }

    function updateMapCenter() {
        if (map) {
            map.setView(userLocation, 14);
            clearMap();
            addMarker(userLocation, 'You are here', '#4F46E5');
        }
    }

    function addMarker(latlng, popupText, color = '#4F46E5') {
        const iconHtml = `<div style="background-color: ${color}; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 8px rgba(0,0,0,0.4);"></div>`;
        const icon = L.divIcon({ html: iconHtml, className: 'custom-marker', iconSize: [16, 16], iconAnchor: [8, 8] });
        const marker = L.marker(latlng, {icon}).addTo(map);
        if (popupText) marker.bindPopup(popupText);
        markers.push(marker);
        return marker;
    }

    function clearMap() {
        markers.forEach(m => map.removeLayer(m));
        markers = [];
        if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    }

    // --- Idle Driver Simulation (Roaming on Roads) ---
    function getRandomNearbyPoint(start, radius) {
        const offsetLat = (Math.random() - 0.5) * radius;
        const offsetLng = (Math.random() - 0.5) * radius;
        return [start[0] + offsetLat, start[1] + offsetLng];
    }

    async function generateIdleDrivers(type, count, baseLocation) {
        clearIdleDrivers(); 
        const icons = { car: '🚗', auto: '🛺', bike: '🛵' };
        const iconEmoji = icons[type];
        
        for(let i=0; i<count; i++) {
            const roughPos = getRandomNearbyPoint(baseLocation, 0.02);
            const snappedPos = await snapToRoad(roughPos);
            
            const icon = L.divIcon({
                html: `<div class="idle-vehicle-marker">${iconEmoji}</div>`,
                className: 'custom-idle-marker',
                iconSize: [32, 32], iconAnchor: [16, 16]
            });
            const marker = L.marker(snappedPos, {icon}).addTo(map);
            
            const driverObj = { marker, currentPos: snappedPos, isRoaming: true };
            idleDrivers.push(driverObj);
            startDriverRoaming(driverObj);
        }
    }

    async function startDriverRoaming(driver) {
        while(driver.isRoaming) {
            const targetRough = getRandomNearbyPoint(driver.currentPos, 0.01);
            const targetSnapped = await snapToRoad(targetRough);
            const routeData = await getRoute(driver.currentPos, targetSnapped);
            
            if (driver.isRoaming && routeData && routeData.coordinates.length > 1) {
                // Roam at ~8 m/s (28km/h)
                await animateAlongRoute(driver, routeData.coordinates, 8);
                if (driver.isRoaming) {
                    driver.currentPos = routeData.coordinates[routeData.coordinates.length - 1];
                }
            } else {
                if (driver.isRoaming) await sleep(2000);
            }
        }
    }

    function clearIdleDrivers() {
        idleDrivers.forEach(d => {
            d.isRoaming = false;
            if (map && map.hasLayer(d.marker)) map.removeLayer(d.marker);
        });
        idleDrivers = [];
    }

    // --- Search Animation ---
    async function playSearchingAnimation() {
        userStatusText.textContent = `Finding nearby ${selectedVehicleData.name}s...`;
        
        for (let i = 0; i < idleDrivers.length; i++) {
            userStatusText.textContent = `Pinging driver ${i+1} / ${idleDrivers.length}...`;
            const el = idleDrivers[i].marker.getElement();
            if (el) {
                const markerDiv = el.querySelector('.idle-vehicle-marker');
                if (markerDiv) markerDiv.classList.add('pinging');
                await sleep(700);
                if (markerDiv) markerDiv.classList.remove('pinging');
            }
        }
        userStatusText.textContent = `Waiting for driver to accept...`;
        await sleep(1000);
    }

    // --- Core Animation Logic for Active & Idle Drivers ---
    async function animateAlongRoute(driverStateObj, coordsArray, speedMetersPerSec) {
        if (!coordsArray || coordsArray.length < 2) return;
        
        let totalDist = 0;
        const segments = [];
        for(let i=0; i<coordsArray.length-1; i++) {
            const d = map.distance(coordsArray[i], coordsArray[i+1]);
            totalDist += d;
            segments.push({start: coordsArray[i], end: coordsArray[i+1], dist: d});
        }

        const durationMs = (totalDist / speedMetersPerSec) * 1000;
        let startTime = performance.now();
        
        return new Promise(resolve => {
            function step(timestamp) {
                // If it's an idle driver and they stopped roaming, abort
                if (driverStateObj.isRoaming === false) return resolve();
                // If it's the active driver and animation was cancelled, abort
                if (driverStateObj.isAnimating === false) return resolve();

                const elapsed = timestamp - startTime;
                if (elapsed >= durationMs) {
                    driverStateObj.marker.setLatLng(coordsArray[coordsArray.length-1]);
                    return resolve();
                }
                
                const targetDist = (elapsed / durationMs) * totalDist;
                let walked = 0;
                let currentSeg = segments[0];
                for (let i=0; i<segments.length; i++) {
                    if (walked + segments[i].dist >= targetDist) {
                        currentSeg = segments[i];
                        break;
                    }
                    walked += segments[i].dist;
                }
                
                const segProgress = currentSeg.dist > 0 ? (targetDist - walked) / currentSeg.dist : 0;
                const lat = currentSeg.start[0] + (currentSeg.end[0] - currentSeg.start[0]) * segProgress;
                const lng = currentSeg.start[1] + (currentSeg.end[1] - currentSeg.start[1]) * segProgress;
                
                driverStateObj.marker.setLatLng([lat, lng]);
                requestAnimationFrame(step);
            }
            requestAnimationFrame(step);
        });
    }

    function createActiveVehicleMarker(latlng, iconEmoji) {
        clearActiveDriver();
        const icon = L.divIcon({
            html: `<div class="vehicle-marker">${iconEmoji}</div>`,
            className: 'custom-vehicle-marker',
            iconSize: [40, 40], iconAnchor: [20, 20]
        });
        activeDriverState.marker = L.marker(latlng, {icon}).addTo(map);
        activeDriverState.isAnimating = true; // Ready to animate
        return activeDriverState;
    }

    function clearActiveDriver() {
        activeDriverState.isAnimating = false;
        if (activeDriverState.marker && map && map.hasLayer(activeDriverState.marker)) {
            map.removeLayer(activeDriverState.marker);
        }
        activeDriverState.marker = null;
    }

    // --- User Flow ---
    calculateBtn.addEventListener('click', async () => {
        const pVal = pickupInput.value;
        const dVal = dropoffInput.value;
        
        if (!pVal) return alert('Please enter a pickup location to proceed.');
        if (!dVal) return alert('Please enter a dropoff location to proceed.');

        calculateBtn.disabled = true;
        const ogText = calculateBtn.textContent;
        calculateBtn.textContent = 'Verifying Locations...';

        let pickupCoords = userLocation;
        if (pVal !== "My Current Location") {
            const pLoc = await geocode(pVal);
            if(!pLoc) {
                calculateBtn.disabled = false; calculateBtn.textContent = ogText;
                return alert('Could not find Pickup location. Please enter a real location.');
            }
            pickupCoords = [pLoc.lat, pLoc.lng];
            pickupInput.value = pLoc.name.split(',')[0];
        }

        const dLoc = await geocode(dVal);
        if(!dLoc) {
            calculateBtn.disabled = false; calculateBtn.textContent = ogText;
            return alert('Could not find Dropoff location. Please enter a real location.');
        }
        let dropoffCoords = [dLoc.lat, dLoc.lng];
        dropoffInput.value = dLoc.name.split(',')[0];

        calculateBtn.textContent = 'Calculating Route...';
        const routeData = await getRoute(pickupCoords, dropoffCoords);
        
        calculateBtn.disabled = false;
        calculateBtn.textContent = ogText;

        if (!routeData) return alert('Could not calculate a road route between these locations.');

        calculateBtn.classList.add('hidden');
        vehicleOptions.classList.remove('hidden');

        estimatedDistanceKm = routeData.distance / 1000; 
        updateVehiclePrices();

        clearMap();
        clearIdleDrivers();

        addMarker(pickupCoords, 'Pickup', '#4F46E5');
        addMarker(dropoffCoords, 'Dropoff', '#10B981');

        // Draw Actual Road Polyline
        routeLine = L.polyline(routeData.coordinates, {color: '#4F46E5', weight: 5, opacity: 0.8}).addTo(map);
        map.fitBounds(routeLine.getBounds(), {padding: [50, 50]});

        currentRide = {
            id: 'RIDE_' + Math.floor(Math.random() * 10000),
            pickup: pickupInput.value,
            dropoff: dropoffInput.value,
            startCoords: pickupCoords,
            endCoords: dropoffCoords,
            routeCoords: routeData.coordinates, // Full path
            status: 'requested',
            distance: estimatedDistanceKm
        };

        const activeCard = document.querySelector('.vehicle-card.active');
        if (activeCard) activeCard.click(); // Spawn idle drivers
    });

    function updateVehiclePrices() {
        vehicleCards.forEach(card => {
            const mult = parseFloat(card.dataset.multiplier);
            const baseFare = 40; 
            const price = Math.round(baseFare + (estimatedDistanceKm * mult));
            card.querySelector('.v-price').textContent = `₹${price}`;
            if (card.classList.contains('active')) selectedVehicleData.fare = price;
        });
    }

    vehicleCards.forEach(card => {
        card.addEventListener('click', () => {
            vehicleCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            const type = card.dataset.type;
            const name = card.querySelector('h4').textContent;
            const icon = card.querySelector('.v-icon').textContent;
            const priceText = card.querySelector('.v-price').textContent;
            
            selectedVehicleData = { type, name, icon, fare: parseInt(priceText.replace('₹', '')) };
            selectedVehicleName.textContent = name;

            generateIdleDrivers(type, Math.floor(Math.random() * 3) + 3, currentRide ? currentRide.startCoords : userLocation);
        });
    });

    bookBtn.addEventListener('click', async () => {
        currentRide.vehicle = selectedVehicleData;
        currentRide.fare = selectedVehicleData.fare;

        bookingForm.classList.remove('active');
        bookingForm.classList.add('hidden');
        rideStatusUser.classList.remove('hidden');
        rideStatusUser.classList.add('active');
        
        userProgress.style.width = '20%';
        finalFareAmount.textContent = `₹${currentRide.fare}`;

        await playSearchingAnimation();

        localStorage.setItem('rideRequest', JSON.stringify(currentRide));
        window.addEventListener('storage', handleStorageEvent);
    });

    payBtn.addEventListener('click', () => {
        alert('UPI Payment processing... Payment Successful!');
        rideStatusUser.classList.remove('active');
        rideStatusUser.classList.add('hidden');
        vehicleOptions.classList.add('hidden');
        calculateBtn.classList.remove('hidden');
        bookingForm.classList.add('active');
        bookingForm.classList.remove('hidden');
        dropoffInput.value = '';
        
        updateMapCenter();
        clearIdleDrivers();
        clearActiveDriver();
        
        payBtn.classList.add('hidden');
        userProgress.style.width = '0%';
        window.removeEventListener('storage', handleStorageEvent);
    });

    // --- Driver Flow ---
    function listenForRequests() {
        checkRequests();
        window.addEventListener('storage', (e) => {
            if (e.key === 'rideRequest') checkRequests();
        });
    }

    function checkRequests() {
        if(currentUserRole !== 'driver') return;
        const reqStr = localStorage.getItem('rideRequest');
        if (reqStr) {
            try {
                const ride = JSON.parse(reqStr);
                if (ride.status === 'requested') showIncomingRequest(ride);
            } catch(e) {}
        } else {
            incomingRequests.innerHTML = '<p class="empty-state">No ride requests yet.</p>';
        }
    }

    function showIncomingRequest(ride) {
        incomingRequests.innerHTML = `
            <div class="request-card">
                <h4>New ${ride.vehicle.name} Request</h4>
                <p><strong>Type:</strong> ${ride.vehicle.icon} ${ride.vehicle.name}</p>
                <p><strong>To:</strong> ${ride.dropoff}</p>
                <p><strong>Dist:</strong> ${parseFloat(ride.distance).toFixed(1)} km</p>
                <p><strong>Fare:</strong> ₹${ride.fare}</p>
                <button class="primary-btn" id="accept-btn" style="margin-top: 10px;">Accept Request</button>
            </div>
        `;
        document.getElementById('accept-btn').addEventListener('click', () => acceptRide(ride));
    }

    async function acceptRide(ride) {
        const driverStartRough = getRandomNearbyPoint(ride.startCoords, 0.01);
        const driverStartSnapped = await snapToRoad(driverStartRough);
        const routeData = await getRoute(driverStartSnapped, ride.startCoords);
        
        ride.driverStartCoords = driverStartSnapped;
        ride.routeToPickupCoords = routeData ? routeData.coordinates : [driverStartSnapped, ride.startCoords];
        ride.status = 'accepted';
        
        localStorage.setItem('rideRequest', JSON.stringify(ride));
        
        driverIdle.classList.remove('active');
        driverIdle.classList.add('hidden');
        driverActive.classList.remove('hidden');
        driverActive.classList.add('active');

        clearMap();
        addMarker(ride.startCoords, 'Pickup', '#4F46E5');
        addMarker(ride.endCoords, 'Dropoff', '#10B981');
        
        // Draw the full ride route on map so driver sees destination
        routeLine = L.polyline(ride.routeCoords, {color: '#4F46E5', weight: 5, opacity: 0.8}).addTo(map);
        map.fitBounds(routeLine.getBounds(), {padding: [50, 50]});

        const activeObj = createActiveVehicleMarker(ride.driverStartCoords, ride.vehicle.icon);
        animateAlongRoute(activeObj, ride.routeToPickupCoords, 15); // 15 m/s to pickup

        currentRide = ride;
    }

    arriveBtn.addEventListener('click', () => {
        driverStatusText.textContent = 'Waiting for rider...';
        arriveBtn.classList.add('hidden');
        startRideBtn.classList.remove('hidden');
        
        currentRide.status = 'arrived';
        localStorage.setItem('rideRequest', JSON.stringify(currentRide));
    });

    startRideBtn.addEventListener('click', () => {
        driverStatusText.textContent = 'En route to destination...';
        startRideBtn.classList.add('hidden');
        completeRideBtn.classList.remove('hidden');

        currentRide.status = 'en_route';
        localStorage.setItem('rideRequest', JSON.stringify(currentRide));

        // Animate along the exact road route!
        const activeObj = createActiveVehicleMarker(currentRide.startCoords, currentRide.vehicle.icon);
        animateAlongRoute(activeObj, currentRide.routeCoords, 12); 
    });

    completeRideBtn.addEventListener('click', () => {
        driverStatusText.textContent = 'Ride completed.';
        completeRideBtn.classList.add('hidden');
        arriveBtn.classList.remove('hidden');

        currentRide.status = 'completed';
        localStorage.setItem('rideRequest', JSON.stringify(currentRide));

        setTimeout(() => {
            driverActive.classList.remove('active');
            driverActive.classList.add('hidden');
            driverIdle.classList.remove('hidden');
            driverIdle.classList.add('active');
            
            clearMap();
            clearActiveDriver();
            checkRequests();
        }, 2000);
    });

    // Handle updates across tabs (for User)
    function handleStorageEvent(e) {
        if (e.key === 'rideRequest' && currentUserRole === 'user') {
            const ride = JSON.parse(e.newValue);
            if (!ride) return;

            if (ride.status === 'accepted') {
                clearIdleDrivers();
                userStatusText.textContent = `${ride.vehicle.name} driver is heading to you...`;
                userProgress.style.width = '40%';
                document.getElementById('assigned-driver-info').innerHTML = `<strong>Driver:</strong> Rajesh K. (${ride.vehicle.icon})`;
                
                const activeObj = createActiveVehicleMarker(ride.driverStartCoords, ride.vehicle.icon);
                animateAlongRoute(activeObj, ride.routeToPickupCoords, 15);

            } else if (ride.status === 'arrived') {
                userStatusText.textContent = 'Driver has arrived!';
                userProgress.style.width = '60%';
                if (activeDriverState.marker) activeDriverState.marker.setLatLng(ride.startCoords);

            } else if (ride.status === 'en_route') {
                userStatusText.textContent = 'Enjoy your ride!';
                userProgress.style.width = '80%';
                
                const activeObj = createActiveVehicleMarker(ride.startCoords, ride.vehicle.icon);
                animateAlongRoute(activeObj, ride.routeCoords, 12);

            } else if (ride.status === 'completed') {
                userStatusText.textContent = 'Ride completed! Please pay the fare.';
                userProgress.style.width = '100%';
                payBtn.classList.remove('hidden');
                if (activeDriverState.marker) activeDriverState.marker.setLatLng(ride.endCoords);
            }
        }
    }
});
