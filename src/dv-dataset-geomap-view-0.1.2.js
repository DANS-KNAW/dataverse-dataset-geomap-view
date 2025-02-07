/*
 * DvDatasetGeoMapViewer
 * This should be called when the page is loaded
 * 
 * Note that this code is dependent on the Dataverse HTML elements and CSS classes and ids.
 * Dataverse is a PrimeFaces (PF) based Java web application.
 * 
 */
function DvDatasetGeoMapViewer() {
    // Archaeology specific values
    let subtree = 'root'; // Note that Dataverse can be configured to have another 'root' verse
    let metadataBlockName = 'dansTemporalSpatial'; // specific metadata block for archaeology containing location coordinates

    let use_feature_extractor = extractDansArchaeologyFeatures; // default feature extractor

    let use_base_url; // optionally use an alternative base url instead of the one of the current web page

    // We use clustering for potential large number of points
    // It also handles the case where more points are on the same location
    // See: https://github.com/Leaflet/Leaflet.markercluster
    let useClustering = true;

    // some id's for element creation and selection
    let geomap_viewer_id = 'geomapview'; // id for the map view div, also used for prefixing
    let map_insertion_id = geomap_viewer_id + '-geomap'; // leaflet map will be inserted in this div

    // Find insertion point for the map view div in Dataverse page
    // something in #dv-main before #resultsTable and after #resultsCountPaginatorBlock
    let viewInsertionBelow = $('#resultsCountPaginatorBlock');
    // alternative is on the side of the search results, would be logical if that was in sync with the search results
    //let viewInsertionBelow = $('#facetType'); // here it suggests you can 'filter' somehow!

    // Note that this is not always there on that page, for instance when not on the daaverse search page
    if(viewInsertionBelow === undefined || viewInsertionBelow.length === 0) {
        console.log('No insertion element found');
        return;
    }

    if (!hasDatasetType()) {
        console.log('No dataset as search type');
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
            $('#' + geomap_viewer_id).show(); 
            $("#resultsTable").hide();
            $(".results-sort-pagination.results-bottom").hide();
            // hide element while keeping layout
            $("#resultsCountPaginatorBlock .results-count").css('visibility', 'hidden');
        } else {
            $('#' + geomap_viewer_id).hide();
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
 
    // Initialize map, with OpenStreetMap centered on the Netherlands but showing most of Europe
    let map = L.map(map_insertion_id).setView([51.505, -0.09], 3);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);

    let markers;
    if (useClustering) {
        markers = L.markerClusterGroup();
        // Note we don't use chunckedloading, but retrieve in batches (pages) would be nice
        // markers =L.markerClusterGroup({ chunkedLoading: true, chunkProgress: updateProgressBar });
    } else {
        markers = L.featureGroup();
    }
    map.addLayer(markers);
  
    let baseUrl = use_base_url ? use_base_url : getBaseUrl();
    let start = 0;
    let pageSize = 1000; // The max for the search API is 1000
    let num_retrieved = 0;
    let searchApiUrl = constructSearchApiUrl(baseUrl)
    doSearchRequest(searchApiUrl);

    updateTabsView(); // Must have everything initialized before this is called

    // --- Functions

    function doSearchRequest(extractionUrl) {
        $('#' + geomap_viewer_id + '-spinner-searchLocation').show();

        const t0 = performance.now();
        $.ajax({url: extractionUrl, 
            success: function(result){
                const t1 = performance.now();
                console.log(`Result of ajax call took ${t1 - t0} milliseconds.`);
                processSearchResult(result);
                start = start + pageSize; // advance to the next page
            }, 
            error: function(xhr, status, error) {
                console.error("Error while doing search request: " + error);
            },
            complete: function () {
                $('#' + geomap_viewer_id + '-spinner-searchLocation').hide();
            }
        });
    }

    function processSearchResult(result) {
        const t0 = performance.now();
        console.log('Total of ' + result.data.total_count + " datasets found");

        let extractedFeatures = use_feature_extractor(result);//extractFeatures(result);
        num_retrieved += extractedFeatures.length; // keep track of the total number of points (features)
        // But also want to know how many datasets have a location

        console.log('Number of features: ' + extractedFeatures.length);

        const markerList = [];

        // Update the map; add the markers corresponding to the features
        // assume points only for now, boundingboxes(rectangles) should be done later
        for (feature of extractedFeatures) {
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
        }
        markers.addLayers(markerList);

        const bounds = markers.getBounds();
        if (bounds.isValid()) { // empty layer has non valid bounds!        
            // zoom to extend; show all markers but zoomed in as much as possible
            // but add some padding for balloons
            map.fitBounds(bounds, {padding: [20, 20]});
        }

        // update result totals retrieval indication
        $("#" + geomap_viewer_id + "-result-totals").html(" Retrieved " + num_retrieved + " point location(s)"+ " (total number of datasets: " + result.data.total_count + ")");
        const t1 = performance.now();
        console.log(`processSearchResult took ${t1 - t0} milliseconds.`);
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
        console.log('Page URL: ' + window.location.href + ', Params: ' + params + ' Search: ' + search);

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

        console.log('Search URL: ' + apiUrl);

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

    function createTabSelection() {
        // With that PrimeFaces HTML; trying to get look-and-feel right is cumbersome!
        // Note: get hover effect right needed to handle the hover event on the li
        let tabs = $('<div id="searchResultsViewTab" class="ui-tabs ui-widget ui-widget-content ui-corner-all ui-hidden-container ui-tabs-top"></div>')
        // remove border-bottom
        tabs.css('border-bottom', '0px');

        let nav_tabs = $('<ul class="ui-tabs-nav ui-helper-reset ui-widget-header ui-corner-all" role="tablist"></ul>')
        
        let list_tab = $('<li class="ui-tabs-header ui-state-default ui-tabs-selected ui-state-active ui-corner-top" role="tab" tabindex="0" aria-expanded="true" aria-selected="true"><a href="" id="list-tab"  aria-controls="list"> List</a></li>');
        nav_tabs.append(list_tab);

        const list_icon = $(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-list-task" viewBox="0 0 16 16">
                <path fill-rule="evenodd" d="M2 2.5a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5V3a.5.5 0 0 0-.5-.5zM3 3H2v1h1z"/>
                <path d="M5 3.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5M5.5 7a.5.5 0 0 0 0 1h9a.5.5 0 0 0 0-1zm0 4a.5.5 0 0 0 0 1h9a.5.5 0 0 0 0-1z"/>
                <path fill-rule="evenodd" d="M1.5 7a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5H2a.5.5 0 0 1-.5-.5zM2 7h1v1H2zm0 3.5a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zm1 .5H2v1h1z"/>
            </svg>`);
        list_tab.find('a').prepend(list_icon);

        let map_tab = $('<li class="ui-tabs-header ui-state-default ui-corner-top" role="tab" tabindex="0" aria-expanded="false" aria-selected="false"><a href="" id="map-tab" aria-controls="map" aria-selected="false"> Map</a></li>'); 
        nav_tabs.append(map_tab);

        const map_icon = $(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-map" viewBox="0 0 16 16">
                <path fill-rule="evenodd" d="M15.817.113A.5.5 0 0 1 16 .5v14a.5.5 0 0 1-.402.49l-5 1a.5.5 0 0 1-.196 0L5.5 15.01l-4.902.98A.5.5 0 0 1 0 15.5v-14a.5.5 0 0 1 .402-.49l5-1a.5.5 0 0 1 .196 0L10.5.99l4.902-.98a.5.5 0 0 1 .415.103M10 1.91l-4-.8v12.98l4 .8zm1 12.98 4-.8V1.11l-4 .8zm-6-.8V1.11l-4 .8v12.98z"/>
            </svg>`);
        map_tab.find('a').prepend(map_icon);

        tabs.append(nav_tabs);
        return tabs;
    }

    // Construct the html elements for the mapview
    // Note that we fixed the height of the map to 480px; was 320px (better for sideview)
    // Also styling done here, could be done in css
    function createMapViewDiv() {
        let mapviewDiv = $('<div id="' + geomap_viewer_id + '"></div>');

        let controls = $('<p style="padding: 5px 0 0 5px;margin: 5px;">Geographic location of published datasets: </p>');
        controls.append('<span id="'+ geomap_viewer_id + '-result-totals"></span>');
        //controls.append('<input id="btnSubmit-searchLocation" type="submit" value="Start Retrieving" />');

        let spinner = $('<span id="' + geomap_viewer_id + '-spinner-searchLocation" style="display:none;"></span>');
        //spinner.append('<span class="spinner-border" role="status" style="width: 1.2rem; height: 1.2rem;" ><span class="sr-only">Loading...</span></span>');
        // Note that we use a resource from the dataverse web application
        spinner.append('<span>Loading...</span><img src="/resources/images/ajax-loading.gif" style="width: 1.2em; height: 1.2em;" />');

        controls.append(spinner);
        
        // More explanantion via tooltip     
        let tooltip = $('<span>&nbsp;</span><span class="glyphicon glyphicon-question-sign tooltip-icon" data-toggle="tooltip" data-placement="auto top" data-trigger="hover" data-original-title="Geographical map showing locations of Datasets when coordinates have been specified in the metadata. Multiple points per dataset are possible. Only up to the first 1000 datasets in the search results are used."></span>');
        controls.append(tooltip);
        tooltip.tooltip();

        mapviewDiv.append(controls);
        mapviewDiv.append('<div id="' + map_insertion_id + '" style="height:480px;"></div>');

        return mapviewDiv;
    }

}

    /**
     * Assumes to get a JSON search result from the Dataverse API
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
                let publication_date = value.published_at.substring(0, 10); // fixed format
                // Only handle points for now!
                // Note that we could also have bounding boxes (rectangles) in the metadata
                dansSpatialPoint = value.metadataBlocks.dansTemporalSpatial.fields.find(x => x.typeName === "dansSpatialPoint");
                // Note that there could be multiple points, even in different schemes
                if (typeof dansSpatialPoint !== "undefined") {
                    for (let i = 0; i < dansSpatialPoint.value.length; i++) {
                        dansSpatialPointX = dansSpatialPoint.value[i]["dansSpatialPointX"].value;
                        dansSpatialPointY = dansSpatialPoint.value[i]["dansSpatialPointY"].value;
                        let lat = 0;
                        let lon = 0;
                        if (dansSpatialPoint.value[i]["dansSpatialPointScheme"].value === "RD (in m.)") {
                            latLon = convertRDtoWGS84(parseFloat(dansSpatialPointX), parseFloat(dansSpatialPointY));
                            lat = latLon.lat;
                            lon = latLon.lon;
                        } else if ( dansSpatialPoint.value[i]["dansSpatialPointScheme"].value === "longitude/latitude (degrees)") {
                            // Assume WGS84 in decimal degrees, no conversion needed
                            lat = parseFloat(dansSpatialPointY);
                            lon = parseFloat(dansSpatialPointX);
                        } else {    
                            console.warn('Spatial point scheme not recognized: ' + dansSpatialPoint.value[i]["dansSpatialPointScheme"].value);
                            continue;
                        }

                        // Check if lat, lon are valid numbers; because the leaflet map can break on invalid coordinates!
                        if (!isWGS84CoordinateValid(lat, lon) ) {
                            console.warn('Invalid WGS84 coordinate: ' + lat + ', ' + lon);
                            continue;
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
                                "publication_date": publication_date,
                                "id": value.global_id
                            }
                        }
                        resultFeatureArr.push(feature);
                    }
                } // End point(s) handling
            }
        });
        const t1 = performance.now();
        console.log(`Call to extractFeatures took ${t1 - t0} milliseconds.`);
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
    }
