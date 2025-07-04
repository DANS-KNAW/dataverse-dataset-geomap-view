/*
 * DvDatasetGeoMapViewer
 * This should be called when the page is loaded
 * 
 * Note that this code is dependent on the Dataverse HTML elements and CSS classes and ids.
 * Dataverse is a PrimeFaces (PF) based Java web application.
 * 
 * options:
 * - maxSearchRequestsPerPage: the number of datasets to retrieve per search request (default 100) 
 *   must be between 1 and 1000 otherwise it is clipped to 1 or 1000
 * 
 */
function DvDatasetGeoMapViewer(options) {
    options = options || {};

    // --- Archaeology (Dataverse archive) specific settings
    let subtree = 'root'; // Note that Dataverse can be configured to have another 'root' verse alias
    let metadataBlockName = 'dansTemporalSpatial'; // specific metadata block for archaeology containing location coordinates
    let featureExtractor = dansDvGeoMap.extractDansArchaeologyFeatures; // specific feature extractor for archaeology

    // filter query to get only datasets with location coordinates, other datasets we cant use for displaying on a map
    // Note that the filter query is specific for the metadata block
    // "dansSpatialBoxNorth:[* TO *]" for the boxes  
    // "dansSpatialPointX:[* TO *]" for the points
    let locationCoordinatesFilterquery = encodeURI("dansSpatialPointX:[* TO *] OR dansSpatialBoxNorth:[* TO *]");

    let alternativeBaseUrl; // optionally use an alternative base url instead of the one of the current web page
    if (options.alternativeBaseUrl) {
        alternativeBaseUrl = options.alternativeBaseUrl;
    }
    // --- apply options if provided

    const maxSearchRequestsPerPage = options.maxSearchRequestsPerPage || 100; // default;  The max for the search API is 1000
    // fix useless values
    if (maxSearchRequestsPerPage > 1000) {
        console.warn('Max search requests per page is too high; setting it to 1000');
        maxSearchRequestsPerPage = 1000;
    } else if (maxSearchRequestsPerPage < 1) {
        console.warn('Max search requests per page is too low; setting it to 1');
        maxSearchRequestsPerPage = 1;
    }

       
    let allowOtherBaseMaps = options.allowOtherBaseMaps || false; // Allow the user to select other base maps (like satellite view)
    let allowRetrievingMore = options.allowRetrievingMore || false; // Allow the user to retrieve more datasets

    // --- Other configuration options
    
    // Known issues: when switching to satellite view, after reload it's is back to the default view
    // should store the selection in session storage

    // We use clustering for potential large number of points
    // It also handles the case where more points are on the same location
    // See: https://github.com/Leaflet/Leaflet.markercluster
    let useClustering = true;

    // some id's for element creation and selection
    const geomapViewerId = 'geomapview'; // id for the map view div, also used for prefixing
    const mapInsertionId = geomapViewerId + '-geomap'; // leaflet map will be inserted in this div

    // Find insertion point for the map view div in Dataverse page
    // something in #dv-main before #resultsTable and after #resultsCountPaginatorBlock
    let viewInsertionBelow = $('#resultsCountPaginatorBlock');
    // alternative is on the side of the search results, would be logical if that was in sync with the search results
    //let viewInsertionBelow = $('#facetType'); // here it suggests you can 'filter' somehow!

    // --- Check if we can continue to create the map viewer, we don't want it on every page

    // Note that this is not always there on that page, for instance when not on the dataverse search page
    if(viewInsertionBelow === undefined || viewInsertionBelow.length === 0) {
        //console.log('No insertion element found; No map viewer created');
        return;
    }

    // The list won't have Datasets so no map viewer is created
    if (!hasDatasetType()) {
        //console.log('No dataset as search type; No map viewer created');
        return;
    }

    // We could also restrict to certain users when logged in, as Beta tester!
    // var userDisplayName = $('#userDisplayInfoTitle').text();
    // Note however that the name is not guaranteed to be unique 


    // --- Tab selection for list or map view

    let tabSelection = createTabSelection();
    tabSelection.insertBefore(viewInsertionBelow);

    // session storage is gone when browser tab or window is closed
    // we only want the selection to survive page reloads because of changes in searching
    let activeTab = sessionStorage.getItem('activeTab');
    let selectedTab = 'list'; // default is the list tab

    if (activeTab) { // we might restrict to values 'list' or 'map' only
        $('#searchResultsViewTab button[aria-controls="' + activeTab + '"]').tab('show');
        selectedTab = activeTab;
    }

    //  PF uses a link instead of a button
    $('#searchResultsViewTab a').on('click', function (event) {
        event.preventDefault();
        selectedTab = $(this).attr('aria-controls');
        sessionStorage.setItem('activeTab', selectedTab);
        updateTabsView();
    });

    // Apply the hover effect for those PF tabs
    $('#searchResultsViewTab li').hover(function(){
        $(this).addClass("ui-state-hover");
    }, function(){
        $(this).removeClass("ui-state-hover");
    });

    /*
     * Update the view based on the selected tab
     * 
     * Note that after a page load the list is always rendered first, 
     * so we need to hide the map if it is selected. 
     * The user will see that list flash by.
     */ 
    function updateTabsView() {
        // For PF: switch class ui-tabs-selected ui-state-active to the li
        $('#searchResultsViewTab li').removeClass('ui-tabs-selected ui-state-active');
        $('#searchResultsViewTab li').find('a[aria-controls= "' + selectedTab + '"]')
            .parent().addClass('ui-tabs-selected ui-state-active');

        if (selectedTab === 'map') {
            $('#' + geomapViewerId).show(); 
            $("#resultsTable").hide();
            $(".results-sort-pagination.results-bottom").hide();
            // hide element while keeping layout
            $("#resultsCountPaginatorBlock .results-count").css('visibility', 'hidden');
        } else {
            $('#' + geomapViewerId).hide();
            $("#resultsTable").show();
            $(".results-sort-pagination.results-bottom").show();
            // show element while keeping layout
            $("#resultsCountPaginatorBlock .results-count").css('visibility', 'visible');
        }
    }  

    // --- Geographic map view with leaflet

    let mapviewDiv = createMapViewDiv();

    // applying some style here, could be done in css
    mapviewDiv.css("background-color", "#f5f5f5");
    mapviewDiv.css("font-size", "14px"); // Somehow font was too small
    mapviewDiv.addClass("border");
    
    mapviewDiv.insertAfter(viewInsertionBelow);
 
    let openStreetMap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    });
    // Initialize map, with OpenStreetMap centered on the Netherlands but showing most of Europe
    // should make this configuarble, but for now it is hardcoded
    var map = L.map(mapInsertionId).setView([51.505, -0.09], 3);
    openStreetMap.addTo(map);

    let boundaryPlacesShown = true;
    if (allowOtherBaseMaps) {
        let esriWorldImagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
        });
        let esriWorldBoundariesPlaces = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: 'Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community'
        });
        let baseLayers = {"OpenStreetMap": openStreetMap, "Satellite": esriWorldImagery};
            let layerControl = L.control.layers(baseLayers).addTo(map);
        L.control.scale().addTo(map);
        map.on('baselayerchange', function (e) {
            if (e.name === "Satellite") {
                if (boundaryPlacesShown) {
                    map.addLayer(esriWorldBoundariesPlaces);
                    layerControl.addOverlay(esriWorldBoundariesPlaces, "Boundaries and Places");
                } else {
                    layerControl.addOverlay(esriWorldBoundariesPlaces, "Boundaries and Places");
                }
            } else {
                layerControl.removeLayer(esriWorldBoundariesPlaces);
                map.removeLayer(esriWorldBoundariesPlaces);
            }
        });
        map.on('overlayadd', function (e) {
            if (e.name === "Boundaries and Places") {
                boundaryPlacesShown = true;
            }
        });
        map.on('overlayremove', function (e) {
            if (e.name === "Boundaries and Places") {
                boundaryPlacesShown = false;
            }
        });
    }

    let markers;
    if (useClustering) {
        markers = L.markerClusterGroup();
        // Note we don't use chunckedloading, but retrieve in batches (pages) would be nice
        // markers =L.markerClusterGroup({ chunkedLoading: true, chunkProgress: updateProgressBar });
    } else {
        markers = L.featureGroup();
    }
    map.addLayer(markers);
  
    let baseUrl = alternativeBaseUrl ? alternativeBaseUrl : getBaseUrl();
    let totalNumberOfDatasetsFound = 0;
    let start = 0;
    let numPagesRetieved = 0;
    let pageSize = maxSearchRequestsPerPage;
    let numRetrieved = 0;
    let searchApiUrl = constructSearchApiUrl(baseUrl)
    doSearchRequest(searchApiUrl);

    updateTabsView(); // Must have everything initialized before this is called

    // --- Functions

    function doSearchRequest(extractionUrl) {
        $('#' + geomapViewerId + '-spinner-searchLocation').show();

        const t0 = performance.now();
        $.ajax({url: extractionUrl, 
            success: function(result){
                const t1 = performance.now();
                //console.log(`Result of ajax call took ${t1 - t0} milliseconds.`);
                processSearchResult(result);
                numPagesRetieved++;
                // determine if more could be retrieved
                if (allowRetrievingMore && numPagesRetieved*pageSize < totalNumberOfDatasetsFound) {
                    start = start + pageSize; // advance to the next page
                    $('#' + geomapViewerId + '-startRetrievingMore').show();
                } else {
                    $('#' + geomapViewerId + '-startRetrievingMore').hide();
                }
            }, 
            error: function(xhr, status, error) {
                console.error("Error while doing search request: " + error);
            },
            complete: function () {
                $('#' + geomapViewerId + '-spinner-searchLocation').hide();
            }
        });
    }

    function processSearchResult(result) {
        const t0 = performance.now();
        totalNumberOfDatasetsFound = result.data.total_count;
        //console.log('Total of ' + result.data.total_count + " datasets found");

        let extractedFeatures = featureExtractor(result);//extractFeatures(result);
        numRetrieved += extractedFeatures.length; // keep track of the total number of points (features)
        // But also want to know how many datasets have a location

        //console.log('Number of features: ' + extractedFeatures.length);

        const markerList = [];

        // Use different color for the marker balloon (icon) 
        // if we have polygons, which is bounding box in simplest case
        let redIcon = L.icon({
            iconUrl: 'https://cdn.rawgit.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.3.1/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
        });
        
        // Update the map; add the markers corresponding to the features
        // assume points only for now, boundingboxes(rectangles) should be done later
        for (feature of extractedFeatures) {
            if (feature.geometry.type === "Point") {
                lon = feature.geometry.coordinates[0];
                lat = feature.geometry.coordinates[1];
                let marker = L.marker([lat, lon]);

                // Note that we do not want the DOI url; instead  a direct url to prevent extra redirect
                const dataset_url = baseUrl + '/dataset.xhtml?persistentId=' + feature.properties.id;
                marker.bindPopup('<a href="' + dataset_url + '"' + '>' + feature.properties.name + '</a><br>' 
                    + feature.properties.authors + "; " 
                    + feature.properties.publication_date + ", <br>" 
                    + feature.properties.id);
                markerList.push(marker);
            } else if (feature.geometry.type === "Polygon") {
                // calculate center of the polygon (could be bounding box)
                // Note that we only use the first polygon, there could be more in the future
                let polygon = L.polygon(feature.geometry.coordinates[0], {color: 'red'});
                // 'red' marker at center
                let bounds = polygon.getBounds();
                let center = bounds.getCenter();
                lon = center.lng;
                lat = center.lat;

                //let marker = L.marker([lat, lon], {icon: redIcon, id: feature.properties.id, key: markerKey}); // Note that we add the id to the marker
                let marker = L.marker([lat, lon], {icon: redIcon, id: feature.properties.id}); // Note that we add the id to the marker
                // Note that we do not want the DOI url; instead  a direct url to prevent extra redirect
                const dataset_url = baseUrl + '/dataset.xhtml?persistentId=' + feature.properties.id;
                marker.bindPopup('<a href="' + dataset_url + '"' + '>' + feature.properties.name + '</a><br>' 
                    + feature.properties.authors + "; " 
                    + feature.properties.publication_date + ", <br>" 
                    + feature.properties.id);
                markerList.push(marker);
            }
        }
        markers.addLayers(markerList);

        const bounds = markers.getBounds();
        if (bounds.isValid()) { // empty layer has non valid bounds!        
            // zoom to extend; show all markers but zoomed in as much as possible
            // but add some padding for balloons
            map.fitBounds(bounds, {padding: [20, 20]});
        }

        // update result totals retrieval indication
        $("#" + geomapViewerId + "-result-totals").html(" Retrieved " + numRetrieved + " point location(s)"+ " (total number of datasets: " + result.data.total_count + ")");
        const t1 = performance.now();
        //console.log(`processSearchResult took ${t1 - t0} milliseconds.`);
    }

    function getBaseUrl() {
        let baseUrl = window.location.protocol + '//' + window.location.hostname;
        baseUrl += window.location.port.length > 0 ? ':' + window.location.port : '';
        // Note that we do not add the path
        return baseUrl;
    }

    // Construct search API URL from the page URL
    // See: https://guides.dataverse.org/en/latest/api/search.html
    // Note that in the new frontend SPA the URL could be different
    function constructSearchApiUrl(baseUrl) {
        let search = window.location.search;
        let params = new URLSearchParams(search);
        //console.log('Page URL: ' + window.location.href + ', Params: ' + params + ' Search: ' + search);

        // Extract and reuse any fq (filter queries) params to filter on       
        // construct new params object for filter queries
        let newParams = new URLSearchParams();
        // first just add all fq params, copy action
        params.getAll('fq').forEach(fq => newParams.append('fq', fq));
        // get fq0, fq1 etc. (from facet selection) from the params and add to the search query
        for (let i = 0; i <= 9; i++) {
            if (params.has(`fq${i}`)) {
                // map to fq without number, API only can handle that one
                newParams.append('fq', params.get(`fq${i}`));
            }
        }

        // TODO: use newParams instead of string concatenation below

        let q = '*'; // make sure we have a query, default is '*', the search API needs it
        if (params.has('q') && params.get('q').length > 0) {
            q = params.get('q');
        }

        // start construction of API URL by appending to the base url
        let apiUrl = baseUrl + '/api/search' + '?' + 'q=' + q;
        apiUrl += '&type=dataset'; // only datasets

        // when newParams is empty, we don't add it to the url
        if (newParams.toString().length !== 0) {
            apiUrl += '&' + newParams.toString();
        }

        // We ignore the paging from the 'list' view, the map should try to get all results
        apiUrl += "&start=" + start + "&per_page=" + pageSize + "&subtree=" + subtree;

        // add params specific for custom metadata containing location coordinates
        apiUrl += '&metadata_fields=' + metadataBlockName + ':*';

        // Extract and reuse any sort params to sort on
        if (params.has('sort')) {
            sort = params.get('sort');
            // remove the 'Sort' part from the value
            sort = sort.replace('Sort', '');
            apiUrl += '&sort=' + sort;
        }
        if(params.has('order')) {   
            order = params.get('order');
            apiUrl += '&order=' + order;
        }

        if (locationCoordinatesFilterquery.length > 0) {
            apiUrl += '&fq=' + locationCoordinatesFilterquery;
        }

        //console.log('Search URL: ' + apiUrl);

        return apiUrl;
    }

    function hasDatasetType() {
        const search = window.location.search;
        const params = new URLSearchParams(search);
        let result = true; // dataset is 'on' by default

        // check if types is specified and if dataset is in the list
        if (params.has('types') ) {
            let types = params.get('types');
            if (!types.includes('dataset')) {
                result = false;
            }
        }
        return result;
    }

    // --- HTML element creation functions

    function createTabSelection() {
        // With that PrimeFaces HTML; trying to get look-and-feel right is cumbersome!
        // Note: get hover effect right needed to handle the hover event on the li
        let tabs = $('<div id="searchResultsViewTab" class="ui-tabs ui-widget ui-widget-content ui-corner-all ui-hidden-container ui-tabs-top"></div>')
        // remove border-bottom
        tabs.css('border-bottom', '0px');

        let navTabs = $('<ul class="ui-tabs-nav ui-helper-reset ui-widget-header ui-corner-all" role="tablist"></ul>')
        
        let listTab = $('<li class="ui-tabs-header ui-state-default ui-tabs-selected ui-state-active ui-corner-top" role="tab" tabindex="0" aria-expanded="true" aria-selected="true"><a href="" id="list-tab"  aria-controls="list"> List</a></li>');
        navTabs.append(listTab);

        const listIcon = $(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-list-task" viewBox="0 0 16 16">
                <path fill-rule="evenodd" d="M2 2.5a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5V3a.5.5 0 0 0-.5-.5zM3 3H2v1h1z"/>
                <path d="M5 3.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5M5.5 7a.5.5 0 0 0 0 1h9a.5.5 0 0 0 0-1zm0 4a.5.5 0 0 0 0 1h9a.5.5 0 0 0 0-1z"/>
                <path fill-rule="evenodd" d="M1.5 7a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5H2a.5.5 0 0 1-.5-.5zM2 7h1v1H2zm0 3.5a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zm1 .5H2v1h1z"/>
            </svg>`);
        listTab.find('a').prepend(listIcon);

        let mapTab = $('<li class="ui-tabs-header ui-state-default ui-corner-top" role="tab" tabindex="0" aria-expanded="false" aria-selected="false"><a href="" id="map-tab" aria-controls="map" aria-selected="false"> Map</a></li>'); 
        navTabs.append(mapTab);

        const mapIcon = $(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-map" viewBox="0 0 16 16">
                <path fill-rule="evenodd" d="M15.817.113A.5.5 0 0 1 16 .5v14a.5.5 0 0 1-.402.49l-5 1a.5.5 0 0 1-.196 0L5.5 15.01l-4.902.98A.5.5 0 0 1 0 15.5v-14a.5.5 0 0 1 .402-.49l5-1a.5.5 0 0 1 .196 0L10.5.99l4.902-.98a.5.5 0 0 1 .415.103M10 1.91l-4-.8v12.98l4 .8zm1 12.98 4-.8V1.11l-4 .8zm-6-.8V1.11l-4 .8v12.98z"/>
            </svg>`);
        mapTab.find('a').prepend(mapIcon);

        tabs.append(navTabs);
        return tabs;
    }

    // Construct the html elements for the mapview
    // Note that we fixed the height of the map to 480px; was 320px (better for sideview)
    // Also styling done here, could be done in css
    function createMapViewDiv() {
        let mapviewDiv = $('<div id="' + geomapViewerId + '"></div>');

        let controls = $('<p style="padding: 5px 0 0 5px;margin: 5px;">Geographic location of published datasets: </p>');
        controls.append('<span id="'+ geomapViewerId + '-result-totals"></span>');
        //controls.append('<input id="btnSubmit-searchLocation" type="submit" value="Start Retrieving" />');

        let spinner = $('<span id="' + geomapViewerId + '-spinner-searchLocation" style="display:none;"></span>');
        //spinner.append('<span class="spinner-border" role="status" style="width: 1.2rem; height: 1.2rem;" ><span class="sr-only">Loading...</span></span>');
        // Note that we use a resource from the dataverse web application
        spinner.append('<span>&nbsp;</span><span>Loading...</span><img src="/resources/images/ajax-loading.gif" style="width: 1.2em; height: 1.2em;" />');

        controls.append(spinner);
        
        if (allowRetrievingMore) {
            // add link to start retrieving more datasets
            let startRetrievingMore = $('<a href="#" id="' + geomapViewerId + '-startRetrievingMore" style="display:none; padding-left: 10px;">More...</a>');
            startRetrievingMore.on('click', function (event) {
                event.preventDefault();
                $('#' + geomapViewerId + '-startRetrievingMore').hide();
                // Note that most of the URL is the same, only the start parameter changes, but just construct it again
                doSearchRequest(constructSearchApiUrl(baseUrl));
            });
            controls.append(startRetrievingMore);
        }

        // More explanantion via tooltip     
        let tooltip = $(`<span>&nbsp;</span><span class="glyphicon glyphicon-question-sign tooltip-icon" data-toggle="tooltip" data-placement="auto top" data-trigger="hover" 
            data-original-title="Geographical map showing locations of Datasets when coordinates have been specified in the metadata. 
            Multiple points per dataset are possible. Initially only up to the first ${maxSearchRequestsPerPage} datasets in the search results are used. 
            Using 'More...' the next ${maxSearchRequestsPerPage} will be retrieved. "></span>`);
        controls.append(tooltip);
        tooltip.tooltip();

        mapviewDiv.append(controls);
        mapviewDiv.append('<div id="' + mapInsertionId + '" style="height:480px;"></div>');

        // add legend at the bottom, assume we always can have points and or bounding boxes
        let legend = $('<div style="padding: 5px 0 0 5px;margin: 5px;">' + 
            'Location Markers: ' +
            '<img src="https://cdn.rawgit.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png" style="height: 2.4rem;" />' +
            ' Point' + 
            '; ' + '<img src="https://cdn.rawgit.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png" style="height: 2.4rem;" />' +
            ' Area ' + 
            ' - The marker is at the center of the bounding box' +
            '</div>');
        mapviewDiv.append(legend);

        return mapviewDiv;
    }
}

/**
 * DANS Module for extracting features from a search result from the Dataverse search API
 */
let dansDvGeoMap = (function() {
    /**
     * Assumes to get a JSON search result from the Dataverse search API
     * and this is from the archaeology data station with the dansTemporalSpatial metadata block
     * 
     * The result is an array with 'geojson' features
     */
    const extractDansArchaeologyFeatures = (result) => {
        const t0 = performance.now();
        const resultFeatureArr = [];

        // console.log('Total of items in this page: ' + result.data.items.length);

        $.each(result.data.items, function (key, value) {
            //console.log('Processing item: ' + value.name);
            if (typeof value.metadataBlocks !== "undefined" &&
                typeof value.metadataBlocks.dansTemporalSpatial !== "undefined") {
                let authors   = value.authors.map(x => x).join(", ");
                let publicationDate = value.published_at.substring(0, 10); // fixed format
                
                // Handle points and bounding boxes
                // Note that there could be multiple, even in different schemes
                // First points
                let dansSpatialPoint = value.metadataBlocks.dansTemporalSpatial.fields.find(x => x.typeName === "dansSpatialPoint");
                if (typeof dansSpatialPoint !== "undefined") {
                    for (let i = 0; i < dansSpatialPoint.value.length; i++) {
                        if (dansSpatialPoint.value[i]["dansSpatialPointScheme"] === undefined ||
                            dansSpatialPoint.value[i]["dansSpatialPointScheme"].value  === undefined ) {
                                console.warn('Invalid dansSpatialPoint: Missing Scheme for: ' + value.global_id);
                            continue;
                        }
                        let dansSpatialPointScheme = dansSpatialPoint.value[i]["dansSpatialPointScheme"].value;

                        dansSpatialPointX = dansSpatialPoint.value[i]["dansSpatialPointX"].value;
                        dansSpatialPointY = dansSpatialPoint.value[i]["dansSpatialPointY"].value;
                        let lat = 0;
                        let lon = 0;
                        if (dansSpatialPointScheme === "RD (in m.)") {
                            latLon = convertRDtoWGS84(parseFloat(dansSpatialPointX), parseFloat(dansSpatialPointY));
                            lat = latLon.lat;
                            lon = latLon.lon;
                        } else if ( dansSpatialPointScheme === "longitude/latitude (degrees)") {
                            // Assume WGS84 in decimal degrees, no conversion needed
                            lat = parseFloat(dansSpatialPointY);
                            lon = parseFloat(dansSpatialPointX);
                        } else {    
                            console.warn('Spatial point scheme not recognized: ' + dansSpatialPointScheme);
                            continue; // skip this point, because we don't know how to convert!
                        }

                        if (!isWGS84CoordinateValid(lat, lon) ) {
                            console.warn('Invalid WGS84 coordinate: ' + lat + ', ' + lon);
                            continue; // skip this point, because leaflet map can break on invalid coordinates!
                        }
                 
                        // add to the features; geojson format so we can export it later
                        const feature = {
                            "type": "Feature",
                            "geometry": {
                                "type": "Point",
                                "coordinates": [lon, lat]
                            },
                            "properties": {
                                "name": value.name,
                                "url": value.url, // note that this is the doi url, with a redirect to the actual dataset, it is persisten so wanted in a json file
                                "authors": authors,
                                "publication_date": publicationDate,
                                "id": value.global_id
                            }
                        }
                        resultFeatureArr.push(feature);
                    }
                } // End point(s) handling

                // Bounding boxes
                let dansSpatialBox = value.metadataBlocks.dansTemporalSpatial.fields.find(x => x.typeName === "dansSpatialBox");
                if (typeof dansSpatialBox !== "undefined") {
                    for (let i = 0; i < dansSpatialBox.value.length; i++) {
                        if (dansSpatialBox.value[i]["dansSpatialBoxScheme"] === undefined ||
                            dansSpatialBox.value[i]["dansSpatialBoxScheme"].value  === undefined ) {
                                console.warn('Invalid dansSpatialBox: Missing Scheme for: ' + value.global_id);
                            continue;
                        }
                        let dansSpatialBoxScheme = dansSpatialBox.value[i]["dansSpatialBoxScheme"].value;

                        dansSpatialBoxNorth = dansSpatialBox.value[i]["dansSpatialBoxNorth"].value;
                        dansSpatialBoxEast = dansSpatialBox.value[i]["dansSpatialBoxEast"].value;
                        dansSpatialBoxSouth = dansSpatialBox.value[i]["dansSpatialBoxSouth"].value;
                        dansSpatialBoxWest = dansSpatialBox.value[i]["dansSpatialBoxWest"].value;
                        //console.log('Spatial box: ' + dansSpatialBoxNorth + ', ' + dansSpatialBoxEast + ', ' + dansSpatialBoxSouth + ', ' + dansSpatialBoxWest);
                        // calculate lat, lon in WGS84, assuming new RD in m.

                        // initialize the feature with the bounding box, WGS8 default
                        var latLon_NE = {lat: parseFloat(dansSpatialBoxNorth), lon: parseFloat(dansSpatialBoxEast)};
                        var latLon_SW = {lat: parseFloat(dansSpatialBoxSouth), lon: parseFloat(dansSpatialBoxWest)};
                        if (dansSpatialBoxScheme === "RD (in m.)") {
                            // convert to WGS84
                            latLon_NE = convertRDtoWGS84(latLon_NE.lon, latLon_NE.lat);
                            latLon_SW = convertRDtoWGS84(latLon_SW.lon, latLon_SW.lat);
                        } else if ( dansSpatialBoxScheme === "longitude/latitude (degrees)") {
                            // Assume WGS84 in decimal degrees, no conversion needed
                        } else {
                            console.warn('Spatial box scheme not recognized: ' + dansSpatialBoxScheme);
                            continue; // skip this box, because we don't know how to convert!
                        }
                        const feature = {
                            "type": "Feature",
                            "geometry": {
                                "type": "Polygon",
                                "coordinates": [[[latLon_SW.lat, latLon_SW.lon],
                                    [latLon_NE.lat, latLon_SW.lon],
                                    [latLon_NE.lat, latLon_NE.lon],
                                    [latLon_SW.lat, latLon_NE.lon],
                                    [latLon_SW.lat, latLon_SW.lon]]] 
                            },
                            "properties": {
                                "name": value.name,
                                "url": value.url, // note that this is the doi url, with a redirect to the actual dataset, it is persisten so wanted in a json file
                                "authors": authors,
                                "publication_date": publicationDate,
                                "id": value.global_id
                            }
                        }
                        // console.log(feature);
                        resultFeatureArr.push(feature);
                    }
                } // End box(es) handling
            }
        });
        const t1 = performance.now();
        //console.log(`Call to extractFeatures took ${t1 - t0} milliseconds.`);
        return resultFeatureArr;
    }

    /**
     * Converts the Dutch 'RD' RijksDriehoek coordinate system to standard WGS84 (GPS) coordinates
     */
    /** Note that I copied this next convert function from the web, 
     * ignoring any errors and not having it validated in any way 
     * Original code copied from https://github.com/glenndehaan/rd-to-wgs84/blob/master/src/index.js
     * For completeness the license is included below:
     * MIT License
     * 
     * Copyright (c) 2017 Glenn de Haan
     * 
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     * 
     * The above copyright notice and this permission notice shall be included in all
     * copies or substantial portions of the Software.
     * 
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
     * SOFTWARE. 
     */
    const convertRDtoWGS84 = (x, y) => {
        const x0 = 155000.000;
        const y0 = 463000.000;

        const f0 = 52.156160556;
        const l0 = 5.387638889;

        const a01 = 3236.0331637;
        const b10 = 5261.3028966;
        const a20 = -32.5915821;
        const b11 = 105.9780241;
        const a02 = -0.2472814;
        const b12 = 2.4576469;
        const a21 = -0.8501341;
        const b30 = -0.8192156;
        const a03 = -0.0655238;
        const b31 = -0.0560092;
        const a22 = -0.0171137;
        const b13 = 0.0560089;
        const a40 = 0.0052771;
        const b32 = -0.0025614;
        const a23 = -0.0003859;
        const b14 = 0.0012770;
        const a41 = 0.0003314;
        const b50 = 0.0002574;
        const a04 = 0.0000371;
        const b33 = -0.0000973;
        const a42 = 0.0000143;
        const b51 = 0.0000293;
        const a24 = -0.0000090;
        const b15 = 0.0000291;

        const dx = (x - x0) * Math.pow(10, -5);
        const dy = (y - y0) * Math.pow(10, -5);

        // Note that we could precalulate some pow values, like dx_2, dx_3 etc. !

        let df = a01 * dy + a20 * Math.pow(dx, 2) + a02 * Math.pow(dy, 2) + a21 * Math.pow(dx, 2) * dy + a03 * Math.pow(dy, 3);
        df += a40 * Math.pow(dx, 4) + a22 * Math.pow(dx, 2) * Math.pow(dy, 2) + a04 * Math.pow(dy, 4) + a41 * Math.pow(dx, 4) * dy;
        df += a23 * Math.pow(dx, 2) * Math.pow(dy, 3) + a42 * Math.pow(dx, 4) * Math.pow(dy, 2) + a24 * Math.pow(dx, 2) * Math.pow(dy, 4);

        const f = f0 + df / 3600;

        let dl = b10 * dx + b11 * dx * dy + b30 * Math.pow(dx, 3) + b12 * dx * Math.pow(dy, 2) + b31 * Math.pow(dx, 3) * dy;
        dl += b13 * dx * Math.pow(dy, 3) + b50 * Math.pow(dx, 5) + b32 * Math.pow(dx, 3) * Math.pow(dy, 2) + b14 * dx * Math.pow(dy, 4);
        dl += b51 * Math.pow(dx, 5) * dy + b33 * Math.pow(dx, 3) * Math.pow(dy, 3) + b15 * dx * Math.pow(dy, 5);

        const l = l0 + dl / 3600;

        const fWgs = f + (-96.862 - 11.714 * (f - 52) - 0.125 * (l - 5)) / 100000;
        const lWgs = l + (-37.902 + 0.329 * (f - 52) - 14.667 * (l - 5)) / 100000;

        return {
            lat: fWgs,
            lon: lWgs
        }
    };

    function isWGS84CoordinateValid(lat, lon) {
        // Lat Lon decimal degrees
        // Note that lon might be valid outside the range -180 to 180, because of cyclic nature
        return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
    };

    function extractDansDccdFeatures(result) {
        const t0 = performance.now();
        const resultFeatureArr = [];

        // console.log('Total of items in this page: ' + result.data.items.length);

        $.each(result.data.items, function (key, value) {
            //console.log('Processing item: ' + value.name);
            if (typeof value.metadataBlocks !== "undefined" &&
                typeof value.metadataBlocks.dccd !== "undefined") {
                let authors   = value.authors.map(x => x).join(", ");
                let publicationDate = value.published_at.substring(0, 10); // fixed format
                // console.log('Authors: ' + authors + '; Publication date: ' + publication_date);

                // Only handle points for now!
                // Note that we could also have bounding boxes (rectangles) in the metadata
                dccdSpatialPoint = value.metadataBlocks.dccd.fields.find(x => x.typeName === "dccd-location");
                // Note that in dccd only point in WGS84!!!!!
                if (typeof dccdSpatialPoint !== "undefined") { // should be there!
                    // console.log('Number of spatial points: ' + dansSpatialPoint.value.length);
                    for (let i = 0; i < dccdSpatialPoint.value.length; i++) {
                        dccdSpatialPointX = dccdSpatialPoint.value[i]["dccd-longitude"].value;
                        dccdSpatialPointY = dccdSpatialPoint.value[i]["dccd-latitude"].value;
                                                // console.log('Spatial point scheme in WGS84: ' + dansSpatialPoint.value[i]["dansSpatialPointScheme"].value);
                        // Assume WGS84 in decimal degrees, no conversion needed
                        let lat = parseFloat(dccdSpatialPointY);
                        let lon = parseFloat(dccdSpatialPointX);

                        if (!isWGS84CoordinateValid(lat, lon) ) {
                            console.warn('Invalid WGS84 coordinate: ' + lat + ', ' + lon);
                            continue; // skip this point, because leaflet map can break on invalid coordinates!
                        }

                        // The next could be use to show the location in a popup somewhere else
                        //location = "<span><a href='http://maps.google.com/maps?z=18&q="+ lat + "," + lon + "' target='_blank'>" + lat  + ", " + lon + "</a></span>";

                        // add to the features; geojson format so we can export it later
                        const feature = {
                            "type": "Feature",
                            "geometry": {
                                "type": "Point",
                                "coordinates": [lon, lat]
                            },
                            "properties": {
                                "name": value.name,
                                "url": value.url, // note that this is the doi url, with a redirect to the actual dataset, it is persisten so wanted in a json file
                                "authors": authors,
                                "publication_date": publicationDate,
                                "id": value.global_id
                            }
                        }
                        // console.log(feature);
                        resultFeatureArr.push(feature);
                    }
                }
            }
        });
        const t1 = performance.now();
        console.log(`Call to extractFeatures took ${t1 - t0} milliseconds.`);
        return resultFeatureArr;
    };

    const extractPointsFromDansArchaeologyMetaDataOnPage = (metadataBlockPointName) =>  {
        let dansSpatialPointText = $(`#metadata_${metadataBlockPointName} > td`).text();
        //console.log('DansSpatialPoint: ' + dansSpatialPointText);
        return extractPointsFromDansArchaeologyMetadataText(dansSpatialPointText);
    };

    const extractPointsFromDansArchaeologyMetadataText = (dansSpatialPointText) =>  {
        const points = []; // point is not a full feature!

        // Note that we know there is a newline separation we will use the regexp matchAll
        // extract Longitude/latitude (degrees)'
         // To match a number, float or int, with optional decimal point: (-?\d+\.?\d*)\s+
        let dansSpatialPointDegreesMatches = dansSpatialPointText.matchAll(/(-?\d+\.?\d*)\s+(-?\d+\.?\d*) Longitude\/latitude \(degrees\)/g);
        for (const match of dansSpatialPointDegreesMatches) {
            //console.log('Lon/Lat (degrees) coordinates found');
            let lon = match[1];
            let lat = match[2];
            //console.log('Lat: ' + lat + '; Lon: ' + lon);
            if (!isWGS84CoordinateValid(lat, lon) ) {
                console.warn('Invalid WGS84 coordinate: ' + lat + ', ' + lon);
                continue; // skip this point, because leaflet map can break on invalid coordinates!
            }
            points.push({"coordinates":[lat, lon], title: `Lon/Lat (degrees): ${lon}, ${lat}`});
        }
        // try matching RD, no negative numbers, some use decimal point
        let dansSpatialPointRDMatches = dansSpatialPointText.matchAll(/(\d+\.?\d*)\s+(\d+\.?\d*) RD \(in m\.\)/g);
        for (const match of dansSpatialPointRDMatches) {
            //console.log('RD (in m.) coordinates found');
            // convert to lat, lon
            let latLon = convertRDtoWGS84(match[1], match[2]);
            //console.log('Lat: ' + latLon.lat + '; Lon: ' + latLon.lon);
            if (!isWGS84CoordinateValid(latLon.lat, latLon.lon) ) {
                console.warn('Invalid WGS84 coordinate: ' + latLon.lat + ', ' + latLon.lon);
                continue; // skip this point, because leaflet map can break on invalid coordinates!
            }
            points.push({"coordinates":[latLon.lat, latLon.lon], "title": `RD (in m.): ${match[1]}, ${match[2]}`});
        }
        return points;
    };

    const extractPolygonsFromDansArchaeologyMetaDataOnPage = (metadataBlockBoxName) =>  {
        let dansSpatialBoxText = $(`#metadata_${metadataBlockBoxName} > td`).text();
        //console.log('DansSpatialBox: ' + dansSpatialBoxText)

        return extractPolygonsFromDansArchaeologyMetadataText(dansSpatialBoxText); 
    };

    const extractPolygonsFromDansArchaeologyMetadataText = (dansSpatialBoxText) =>  {
        // for DANS arch. we have bounding boxes, but we handle them as polygons
        let polygons = [];
        // To match a number, float or int, with optional decimal point: (-?\d+\.?\d*)\s+
        let dansSpatialBoxDegreesMatches = dansSpatialBoxText.matchAll(/(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*) Longitude\/latitude \(degrees\)/g);
        for (const match of dansSpatialBoxDegreesMatches) {
            //console.log('Lon/Lat (degrees) coordinates found');
            let dansSpatialBoxNorth = match[1];
            let dansSpatialBoxEast = match[2];
            let dansSpatialBoxSouth = match[3];
            let dansSpatialBoxWest = match[4];

            // initialize the feature with the bounding box, WGS8 default
            var latLon_NE = {lat: parseFloat(dansSpatialBoxNorth), lon: parseFloat(dansSpatialBoxEast)};
            var latLon_SW = {lat: parseFloat(dansSpatialBoxSouth), lon: parseFloat(dansSpatialBoxWest)};

            if (!isWGS84CoordinateValid(latLon_NE.lat, latLon_NE.lon) ) {
                console.warn('Invalid WGS84 coordinate: ' + latLon_NE.lat + ', ' + latLon_NE.lon);
                continue; // skip this point, because leaflet map can break on invalid coordinates!
            }
            if (!isWGS84CoordinateValid(latLon_SW.lat, latLon_SW.lon) ) {
                console.warn('Invalid WGS84 coordinate: ' + latLon_SW.lat + ', ' + latLon_SW.lon);
                continue; // skip this point, because leaflet map can break on invalid coordinates!
            }
            // valid feature
            polygons.push({"coordinates": [[latLon_SW.lat, latLon_SW.lon],
                                    [latLon_NE.lat, latLon_SW.lon],
                                    [latLon_NE.lat, latLon_NE.lon],
                                    [latLon_SW.lat, latLon_NE.lon],
                                    [latLon_SW.lat, latLon_SW.lon]], 
                                    "title": `Lon/Lat (degrees): ${dansSpatialBoxNorth}, ${dansSpatialBoxEast}, 
                                    ${dansSpatialBoxSouth}, ${dansSpatialBoxWest}`});
        }

        // try matching RD, no negative numbers, some use decimal point
        let dansSpatialBoxRDMatches = dansSpatialBoxText.matchAll(/(\d+\.?\d*)\s+(\d+\.?\d*)\s+(\d+\.?\d*)\s+(\d+\.?\d*) RD \(in m\.\)/g);
        for (const match of dansSpatialBoxRDMatches) {
            //console.log('RD (in m.) coordinates found');
            let dansSpatialBoxNorth = match[1];
            let dansSpatialBoxEast = match[2];
            let dansSpatialBoxSouth = match[3];
            let dansSpatialBoxWest = match[4];

            var latLon_NE = {lat: parseFloat(dansSpatialBoxNorth), lon: parseFloat(dansSpatialBoxEast)};
            var latLon_SW = {lat: parseFloat(dansSpatialBoxSouth), lon: parseFloat(dansSpatialBoxWest)};
            // convert to WGS84
            latLon_NE = convertRDtoWGS84(latLon_NE.lon, latLon_NE.lat);
            latLon_SW = convertRDtoWGS84(latLon_SW.lon, latLon_SW.lat);
            if (!isWGS84CoordinateValid(latLon_NE.lat, latLon_NE.lon) ) {
                console.warn('Invalid WGS84 coordinate: ' + latLon_NE.lat + ', ' + latLon_NE.lon);
                continue; // skip this point, because leaflet map can break on invalid coordinates!
            }
            if (!isWGS84CoordinateValid(latLon_SW.lat, latLon_SW.lon) ) {
                console.warn('Invalid WGS84 coordinate: ' + latLon_SW.lat + ', ' + latLon_SW.lon);
                continue; // skip this point, because leaflet map can break on invalid coordinates!
            }
            // valid feature
            polygons.push({"coordinates": [[latLon_SW.lat, latLon_SW.lon],
                                    [latLon_NE.lat, latLon_SW.lon],
                                    [latLon_NE.lat, latLon_NE.lon],
                                    [latLon_SW.lat, latLon_NE.lon],
                                    [latLon_SW.lat, latLon_SW.lon]], 
                                    "title": `RD (in m.): ${dansSpatialBoxNorth}, ${dansSpatialBoxEast}, 
                                    ${dansSpatialBoxSouth}, ${dansSpatialBoxWest}`});
        }

        return polygons;
    };

    return {
        extractDansArchaeologyFeatures, extractDansDccdFeatures, 
        extractPointsFromDansArchaeologyMetaDataOnPage, extractPolygonsFromDansArchaeologyMetaDataOnPage,
        extractPointsFromDansArchaeologyMetadataText, extractPolygonsFromDansArchaeologyMetadataText
    };
})();

/**
 * Maps for the Dataset Metadata Page,
 * Adds maps in the metadata block with coordinates, for points boxes or both
 * 
 * @param {} options 
 */
function DvDatasetMDGeoMapViewer(options) {
    options = options || {}; // nothing yet

    //console.log('DvDatasetMDGeoMapViewer');

    DvDatasetMDSummaryGeoMapViewer(); // make it optional later

    // TODO make the maps in the custom block (the rest of the code) also optional


    // where to get the coordinates and how to extract shoudl be made configuarble
    // inital attemp..
    
    // --- Archaeology (Dataverse archive) specific settings
    //let metadataBlockName = 'dansTemporalSpatial'; // specific metadata block for archaeology containing location coordinates
    // first the title of the metadat block that contains the coordinates, 
    // need this to find the metadata
    let metadatBlockTitle = 'Temporal and Spatial Coverage';
    let metadataBlockBoxName = 'dansSpatialBox';
    let metadataBlockPointName = 'dansSpatialPoint'; 
    // note that sometimes we have only box or only point. 
    let polygonExtractor = dansDvGeoMap.extractPolygonsFromDansArchaeologyMetaDataOnPage;
    let pointExtractor = dansDvGeoMap.extractPointsFromDansArchaeologyMetaDataOnPage;


    // check if we have what we need
    if (typeof metadatBlockTitle === "undefined") {
        console.warn('No metadata block title found, cannot create map');
        return;
    }

    if (typeof metadataBlockBoxName !== "undefined") {
        // Detect if we have bounding box metadata
        let metadataBlockBoxId = `metadata_${metadataBlockBoxName}`;
        let metadata_spatialBox = $('#' + metadataBlockBoxId);
        if (metadata_spatialBox.length > 0) {
            //console.log('Spatial Box metadata found');

            let polygons = polygonExtractor(metadataBlockBoxName);

            // bounding boxes in their own map
            // check if we have polygons
            if (polygons.length > 0) {
                //console.log('Polygons: ' + polygons);
                // detect tab selection for datasetForm:tabView
                $('#datasetForm').on('click', function(event) {
                    // match 'Temporal and Spatial Coverage'  with regex
                    // Note that some parent element will also have this ...
                    // could try to narrow it down, luckily we chEck for existence of the metadata_dansSpatialPoint
                    // in that createMapPreview function
                    //let matchTitle = event.target.textContent.match(/\s*Temporal and Spatial Coverage\s*/);
                    let matchTitle = event.target.textContent.match(new RegExp(`\\s*${metadatBlockTitle}\\s*`));

                    if (matchTitle !== null) {
                        //console.log(`Clicked ${metadatBlockTitle}`);
                        createMapPreviewBoxes('#' + metadataBlockBoxId, polygons);
                        // if (mapPreviewLocation !== undefined && mapPreviewLocation !== null) {
                        // could do some stuff here
                    }
                });
            } else {
                //console.log(`No polygons found in ${metadataBlockBoxName}`);
            }
        }
    } else {
        //console.log(`No metadata block for bounding boxes configured`);
    }

    if (typeof metadataBlockPointName !== "undefined") {
        // Detect if we have points metadata
        let metadataBlockPointId = `metadata_${metadataBlockPointName}`;
        let metadata_spatialPoint = $('#' + metadataBlockPointId);
        if (metadata_spatialPoint.length > 0) {
            //console.log('Spatial Point metadata found');
            
            let points = pointExtractor(metadataBlockPointName);
            
            if (points.length > 0 ) {
                //console.log('Points: ' + points);

                // detect tab selection for datasetForm:tabView
                $('#datasetForm').on('click', function(event) {
                    let matchTitle = event.target.textContent.match(new RegExp(`\\s*${metadatBlockTitle}\\s*`));
                    if (matchTitle !== null) {
                        //console.log(`Clicked ${metadatBlockTitle}`);
                        mapPreviewLocation = createMapPreviewPoints('#' + metadataBlockPointId, points);
                        // if (mapPreviewLocation !== undefined && mapPreviewLocation !== null) {
                        // could do some stuff here
                    }
                });
            } else {
                //console.log(`No points found in ${metadataBlockPointName}`);
            }
        }
    } else {  
        //console.log(`No metadata block for points configured`);
    }

    /* Functions */

    function createMapPreviewPoints(id, points) {
        const preview_id_prefix = 'points' + '_';

        //$(id).find('#mapPreview').remove(); // then with every click we remove adn reset the map preview
        // If I just return when it is there
        if ($(id).find('#' + preview_id_prefix + 'mapPreview').length > 0 ) {
            //console.log('Map preview already exists');
            return null; // return  if found, nothing to do
        }

        // create a map preview
        let mapPreview = $('<div id="' + preview_id_prefix + 'mapPreview"></div>');
        $(id).append(mapPreview);

        // add a map from OpenStreetMap, without leaflet, but we could use leaflet on other places in the page
        //mapPreview.append(`<iframe width="425" height="350" 
        //src="https://www.openstreetmap.org/export/embed.html?bbox=4.335222244262696%2C52.076967398325245%2C4.34735655784607%2C52.08255213979543&amp;layer=mapnik&amp;
        //marker=${lat}%2C${lon}" style="border: 1px solid black"></iframe>
        //   <br/><small><a href="https://www.openstreetmap.org/?mlat=${lat}&amp;mlon=${lon}#map=17/${lat}/${lon}" target="_blank">View Larger Map</a></small>`);
        //
        //mapPreview.append(`<br/><small><a href="https://www.openstreetmap.org/?mlat=${lat}&amp;mlon=${lon}#map=17/${lat}/${lon}" target="_blank">View Larger Map</a></small>`);
        
        // use leaflet to show the map
        let mapDiv = $('<div id="' + preview_id_prefix + 'geomapPreviewLocation" style="width:320px;height:240px;min-height:240px;border:1px solid;margin-bottom:5px;"></div>');
        mapPreview.append(mapDiv);
        // create a leaflet map
        let mapPreviewLocation = L.map('' + preview_id_prefix + 'geomapPreviewLocation').setView([52.0, 5.0], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18,
            attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors, ' +
                '<a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, ' +
                'Imagery © <a href="https://www.openstreetmap.org/">OpenStreetMap</a>'
        }).addTo(mapPreviewLocation);

        let markers = [];
        // get each point from points
        for (let i = 0; i < points.length; i++) {
            let point = points[i];
            //console.log('Point: ' + point.coordinates);
            let lat = point.coordinates[0];
            let lon = point.coordinates[1];
            // add a marker for each point
            let marker = L.marker([lat, lon])
                .bindPopup(point.title);
            markers.push(marker);
        }
        const featureGroup = L.featureGroup(markers).addTo(mapPreviewLocation);
        // zoom to extend; show all markers but zoomed in as much as possible
        mapPreviewLocation.fitBounds(featureGroup.getBounds(), {padding: [20, 20]});
        mapPreviewLocation.invalidateSize();
        // since all this is part of (animated) bootstrap (PrimeFaces) stuff for the panel this is on
        // we need to trigger a resize event to get the map to show correctly
        // When incorrect, just a little manual browser window resizing seems to fix it....
        // Now to fix it we need to do the invalidateSize  with a delay !    
        setTimeout(() => {
            mapPreviewLocation.invalidateSize();
            mapPreviewLocation.fitBounds(featureGroup.getBounds());
            // make the bounds a bit wider
            mapPreviewLocation.fitBounds(featureGroup.getBounds(), {padding: [20, 20]});
            // window.dispatchEvent(new Event('resize'));
        }, 300); // slight delay helps with animations/layout shifts
    }

    function createMapPreviewBoxes(id, polygons) {
        const preview_id_prefix = 'boxes' + '_';
        //$(id).find('#mapPreview').remove(); // then with every click we remove adn reset the map preview
        // If I just return when it is there
        if ($(id).find('#' + preview_id_prefix + 'mapPreview').length > 0 ) {
            //console.log('Map preview already exists');
            return null; // return  if found, nothing to do
        }

        // create a map preview
        let mapPreview = $('<div id="' + preview_id_prefix + 'mapPreview"></div>');
        $(id).append(mapPreview);

        // Use different color for the marker balloon (icon) 
        // if we have polygons, which is bounding box in simplest case
        let redIcon = L.icon({
            iconUrl: 'https://cdn.rawgit.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.3.1/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
        });

        // add a map from OpenStreetMap, without leaflet, but we could use leaflet on other places in the page
        //mapPreview.append(`<iframe width="425" height="350" 
        //src="https://www.openstreetmap.org/export/embed.html?bbox=4.335222244262696%2C52.076967398325245%2C4.34735655784607%2C52.08255213979543&amp;layer=mapnik&amp;
        //marker=${lat}%2C${lon}" style="border: 1px solid black"></iframe>
        //   <br/><small><a href="https://www.openstreetmap.org/?mlat=${lat}&amp;mlon=${lon}#map=17/${lat}/${lon}" target="_blank">View Larger Map</a></small>`);
        //
        //mapPreview.append(`<br/><small><a href="https://www.openstreetmap.org/?mlat=${lat}&amp;mlon=${lon}#map=17/${lat}/${lon}" target="_blank">View Larger Map</a></small>`);
        
        // use leaflet to show the map
        let mapDiv = $('<div id="' + preview_id_prefix + 'geomapPreviewLocation" style="width:320px;height:240px;min-height:240px;border:1px solid;margin-bottom:5px;"></div>');
        mapPreview.append(mapDiv);
        // create a leaflet map
        let mapPreviewLocation = L.map('' + preview_id_prefix + 'geomapPreviewLocation').setView([52.0, 5.0], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18,
            attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors, ' +
                '<a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, ' +
                'Imagery © <a href="https://www.openstreetmap.org/">OpenStreetMap</a>'
        }).addTo(mapPreviewLocation);

        let markers = [];
        // get each point from points
        for (let i = 0; i < polygons.length; i++) {
            let polygon = polygons[i];
            //console.log('polygon: ' + polygon.coordinates);

            // calculate center of the polygon (could be bounding box)
            // Note that we only use the first polygon, there could be more in the future
            let p = L.polygon(polygon.coordinates, {color: 'red'});

            // add the polygon to the map
            //p.addTo(mapPreviewLocation);
            markers.push(p); // markers name is misleading , 
            // should be features or we put the polygons in different layer?

            // 'red' marker at center
            let bounds = p.getBounds();
            let center = bounds.getCenter();
            lon = center.lng;
            lat = center.lat;

            // add a marker for each polygon
            let marker = L.marker([lat, lon], {icon: redIcon})
                .bindPopup(polygon.title);

            markers.push(marker);
        }
        const featureGroup = L.featureGroup(markers).addTo(mapPreviewLocation);
        // zoom to extend; show all markers but zoomed in as much as possible
        mapPreviewLocation.fitBounds(featureGroup.getBounds(), {padding: [20, 20]});
        mapPreviewLocation.invalidateSize();
        // since all this is part of (animated) bootstrap (PrimeFaces) stuff for the panel this is on
        // we need to trigger a resize event to get the map to show correctly
        // When incorrect, just a little manual browser window resizing seems to fix it....
        // Now to fix it we need to do the invalidateSize  with a delay !    
        setTimeout(() => {
            mapPreviewLocation.invalidateSize();
            mapPreviewLocation.fitBounds(featureGroup.getBounds());
            // make the bounds a bit wider
            mapPreviewLocation.fitBounds(featureGroup.getBounds(), {padding: [20, 20]});
            // window.dispatchEvent(new Event('resize'));
        }, 300); // slight delay helps with animations/layout shifts

    }
}

function DvDatasetMDSummaryGeoMapViewer() {
    const summaryMetdata = $("#dataset-summary-metadata");
    if (summaryMetdata.length > 0) {
        //console.log('DvDatasetMDSummaryGeoMapViewer: dataset-summary-metadata found');

        let points = [];
        let polygons = [];

        // find points and or boxes
        const summaryPoints = summaryMetdata.find('#dansSpatialPoint');
        const summaryBoxes = summaryMetdata.find('#dansSpatialBox');
        if (summaryPoints.length > 0) {
            //console.log('Summary points found');
            let dansSpatialPointText = summaryPoints.find("td").text();
            //console.log('Summary DansSpatialPoint: ' + dansSpatialPointText);

            let pointExtractor = dansDvGeoMap.extractPointsFromDansArchaeologyMetadataText;
            // extract points from the text
            points.push(...pointExtractor(dansSpatialPointText));
            //console.log('Points extracted: ' + points.length);
        }       
        if  (summaryBoxes.length > 0) {
            //console.log('Summary boxes found');
            let dansSpatialBoxText = summaryBoxes.find("td").text();
            //console.log('Summary DansSpatialBox: ' + dansSpatialBoxText);

            let polygonExtractor = dansDvGeoMap.extractPolygonsFromDansArchaeologyMetadataText;
            // extract polygons from the text
            polygons.push(...polygonExtractor(dansSpatialBoxText));
            //console.log('Polygons extracted: ' + polygons.length);
        }  
    
        if  (points.length > 0 || polygons.length > 0) {
            //console.log('Summary points or boxes found, creating map preview');
            // insert map just after the summary
            const preview_id_prefix = 'summary_'; // prefix for the map preview id
            const mapPreview = $('<div id="' + preview_id_prefix + 'mapPreview"></div>');
            //summaryMetdata.append(mapPreview); // inside the summary metadata, at the end
            mapPreview.insertBefore('#contentTabs'); // insert before the content tabs, so it is visible

            // Use different color for the marker balloon (icon) 
            // if we have polygons, which is bounding box in simplest case
            let redIcon = L.icon({
                iconUrl: 'https://cdn.rawgit.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
                shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.3.1/images/marker-shadow.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
                shadowSize: [41, 41]
            });

            // create a map
            // use leaflet to show the map
            let mapDiv = $('<div id="' + preview_id_prefix + 'geomapPreviewLocation" style="height:240px;min-height:240px;border:1px solid;margin-bottom:5px;"></div>');
            mapPreview.append(mapDiv);
            // create a leaflet map
            let mapPreviewLocation = L.map('' + preview_id_prefix + 'geomapPreviewLocation').setView([52.0, 5.0], 12);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 18,
                attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors, ' +
                    '<a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, ' +
                    'Imagery © <a href="https://www.openstreetmap.org/">OpenStreetMap</a>'
            }).addTo(mapPreviewLocation);
            
            let markers = [];
            // get each point from points
            for (let i = 0; i < points.length; i++) {
                let point = points[i];
                //console.log('Point: ' + point.coordinates);
                let lat = point.coordinates[0];
                let lon = point.coordinates[1];
                // add a marker for each point
                let marker = L.marker([lat, lon])
                    .bindPopup(point.title);
                markers.push(marker);
            }
            // get each polygon from polygons
            for (let i = 0; i < polygons.length; i++) {
                let polygon = polygons[i];
                //console.log('polygon: ' + polygon.coordinates);
                // calculate center of the polygon (could be bounding box)
                // Note that we only use the first polygon, there could be more in the future
                let p = L.polygon(polygon.coordinates, {color: 'red'}); 

                // add the polygon to the map
                //p.addTo(mapPreviewLocation);      
                markers.push(p); // markers name is misleading ,
                // should be features or we put the polygons in different layer?    
                // 'red' marker at center
                let bounds = p.getBounds();

                let center = bounds.getCenter();
                lon = center.lng;
                lat = center.lat;   
                // add a marker for each polygon
                let marker = L.marker([lat, lon], {icon: redIcon})
                    .bindPopup(polygon.title);
                markers.push(marker);
            }

            const featureGroup = L.featureGroup(markers).addTo(mapPreviewLocation);
            mapPreviewLocation.fitBounds(featureGroup.getBounds(), {padding: [20, 20]});
            mapPreviewLocation.invalidateSize();
        }
    }

}