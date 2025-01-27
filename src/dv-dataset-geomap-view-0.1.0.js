/* */
function DvDatasetGeoMapViewer(id) {
    // Find insertion point for the map view div
    let viewInsertionBelow = $('#' + id );
    // alternative is on the side of the search results, would be logical if that was in sync with the search results
    //let viewInsertionBelow = $('#facetType'); // here it suggests you can 'filter' somehow!

    // Note that this is not always there on that page
    if(viewInsertionBelow === undefined || viewInsertionBelow.length === 0) {
        console.log('No insertion element found');
        return; // Nothing to insert or attach to!
    }

    if (!hasDatasetType()) {
        console.log('No dataset as search type');
        return;
    }

    // We could further restrict display to only specific sub-verses, determined by the url

    // We could also restrict to certain users when logged in, as Beta tester!
    // Note however that the name is not guaranteed to be unique 
    // var userDisplayName = $('#userDisplayInfoTitle').text();

    // TODO: give selection (button or tabview) to switch between map and list view
    // default is the list view
    // when map is selected we need to store it in a session (sessionStorage)
    //  or localstorage
    // and retrieve it when the page is reloaded, 
    // otherwise we would need to select map after every reload/search query change
    // bootstrap nav-tabs or nav-pills could be used for this


    // --- tab stuff
    var tabSelection = createTabSelection();
    tabSelection.insertBefore(viewInsertionBelow);
    //tabSelection.insertAfter($('#resultsCountPaginatorBlock .results-count'));

    // get stored value from local storage or session storage
    // session storage is gone when browser tab or window is closed
    // we only want the selection to survive page reloads because of changes in searching
    var activeTab = sessionStorage.getItem('activeTab'); //localStorage.getItem('activeTab');
    // Maybe? Escape the value for security against injection XSS, better save than sorry
    //activeTab = escape(activeTab)

    var selectedTab = 'list'; // default

    // if activeTab is not null, then show the tab
    if (activeTab) { // we might restrict to values 'list' or 'map' only
        console.log('activeTab: ' + activeTab)
        $('#searchResultsViewTab button[aria-controls="'+activeTab+'"]').tab('show')
        selectedTab = activeTab;
    }
    // Note that 'list' is default


    //$('#searchResultsViewTab button').on('click', function (event) { // BS used button, PF uses a
    $('#searchResultsViewTab a').on('click', function (event) {
        event.preventDefault()
        //$(this).tab('show') // BS
        // For PF: switch class ui-tabs-selected ui-state-active to the li
        //$('#searchResultsViewTab li').removeClass('ui-tabs-selected ui-state-active');
        //$(this).parent().addClass('ui-tabs-selected ui-state-active');

        // do other tab specific stuff here
        console.log('clicked: ' + $(this).attr('id'))

        selectedTab = $(this).attr('aria-controls');
        // store the active tab in local storage
        //localStorage.setItem('activeTab', $(this).attr('aria-controls'));
        sessionStorage.setItem('activeTab', selectedTab);

        updateTabsView();
    })

    // need to fix the hover effect for those PF tabs
    $('#searchResultsViewTab li').hover(function(){
        //console.log('hovered in: ' + $(this).find('a').attr('id'))
        $(this).addClass("ui-state-hover");
    }, function(){
        //console.log('hovered out: ' + $(this).find('a').attr('id'))
        $(this).removeClass("ui-state-hover");
    });

    function updateTabsView() {
        // For PF: switch class ui-tabs-selected ui-state-active to the li
        $('#searchResultsViewTab li').removeClass('ui-tabs-selected ui-state-active');
        $('#searchResultsViewTab li').find('a[aria-controls= "' + selectedTab + '"]').parent().addClass('ui-tabs-selected ui-state-active');

        if (selectedTab === 'map') {
            // do map stuff
            console.log('Map tab selected');
            $('#mapview').show(); 
            $("#resultsTable").hide();
            $(".results-sort-pagination.results-bottom").hide();
            // hide element while keeping layout
            $("#resultsCountPaginatorBlock .results-count").css('visibility', 'hidden');
        } else {
            // do list stuff
            console.log('List tab selected');
            $('#mapview').hide();
            $("#resultsTable").show();
            $(".results-sort-pagination.results-bottom").show();
            // show element while keeping layout
            $("#resultsCountPaginatorBlock .results-count").css('visibility', 'visible');
        }
    }  

    // --- map stuff

    var mapviewDiv = createMapViewDiv();
    mapviewDiv.css("background-color", "#f5f5f5");
    mapviewDiv.css("font-size", "14px"); // somehow font is too small
    mapviewDiv.addClass("border");
    
    mapviewDiv.insertAfter(viewInsertionBelow);
 
    // problems if we do it here    updateTabsView();

    // Initialize map, with OpenStreetMap centered on the Netherlands but showing most of europe
    var map = L.map('geomap').setView([51.505, -0.09], 3);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);

    // We use clustering for potential large number of points
    // It also handles the case where more points are on the same location
    // https://github.com/Leaflet/Leaflet.markercluster
    var useClustering = true;

    var markers;
    if (useClustering) {
        markers = L.markerClusterGroup();
        // Note we don't use chunckedloading, but retrieve in batches (pages) would be nice
        //markers =L.markerClusterGroup({ chunkedLoading: true, chunkProgress: updateProgressBar });
    } else {
        markers = L.featureGroup();
    }

    map.addLayer(markers);
  
    var baseUrl = getBaseUrl();
    // assume first page, should be retrieved from the url, 
    // or we just always try to retrieve all results up to a certain limit (1000 for now?)
    var start = 0;
    var pageSize = 1000; // default listing pagesize in dataverse is 10, but we could use more, just not more than 1000
    var num_retrieved = 0;
    var searchApiUrl = constructSearchApiUrl(baseUrl)


    doSearchRequest(searchApiUrl);

    updateTabsView(); // must have everything initialized before this call

    function doSearchRequest(extractionUrl) {
        $('#spinner-searchLocation').show();

        //var extractionUrl = "https://archaeology.datastations.nl/api/search?q=*&start="+start+"&per_page="+ pageSize+"&subtree=root&type=dataset&metadata_fields=dansTemporalSpatial:*";
        
        // Getting EASY specific location metadata from its subverse
        const t0 = performance.now();
        $.ajax({url: extractionUrl, 
            success: function(result){
                const t1 = performance.now();
                console.log(`Result of ajax call took ${t1 - t0} milliseconds.`);
                processSearchResult(result)

                // the next page
                start = start + pageSize;
                //$("#btnSubmit-searchLocation").val("Retrieve next "+ pageSize);
            }, 
            error: function(xhr, status, error) {
                console.log("Error: " + error);
            },
            complete: function () {
                $('#spinner-searchLocation').hide();
            }
        });
    }

    function processSearchResult(result) {
        console.log('Total of ' + result.data.total_count + " datasets found");

        extractedFeatures = extractFeatures(result);
        num_retrieved += extractedFeatures.length;
        console.log('Number of features: ' + extractedFeatures.length);

        var markerList = [];

        // Update the map; add the markers corresponding to the features
        // assume points only for now, boundingboxes(rectangles) shoudl be done later
        for (feature of extractedFeatures) {
            // append to leaflet map
            lon = feature.geometry.coordinates[0];
            lat = feature.geometry.coordinates[1];
            //var marker = L.marker([lat,lon]).addTo(map);
            var marker = L.marker([lat, lon]);

            // note that we do not want the DOI url; instead  a direct url to prevent extra redirect like; 
            // https://archaeology.datastations.nl/dataset.xhtml?persistentId=doi:10.17026/dans-x4d-b746
            var dataset_url = baseUrl + '/dataset.xhtml?persistentId=' + feature.properties.id;//feature.properties.url;
            // open in new window when not embedded
            //marker.bindPopup('<a href="' + dataset_url + '"' + ' target="_blank"' + '>' + feature.properties.name + '</a><br>' + feature.properties.id);
            // change current window
            marker.bindPopup('<a href="' + dataset_url + '"' + '>' + feature.properties.name + '</a><br>' 
                + feature.properties.authors + "; " 
                + feature.properties.publication_date + ", <br>" 
                + feature.properties.id);

            //markers.addLayer(marker);
            markerList.push(marker);
        }
        markers.addLayers(markerList);

        // zoom to extend; show all markers but zoomed in as much as possible
        map.fitBounds(markers.getBounds());

        // update controls for download
        $("#result-totals").html(" Retrieved " + num_retrieved + " with a point location"+ " (total number of datasets: " + result.data.total_count + ")");
        //if (num_retrieved > 0) $("#btnSubmit-searchLocation").prop('disabled', false);
        //$("#resultsCountPaginatorBlock .results-count").html(" Retrieved " + num_retrieved + " with a point location"+ " (total number of datasets: " + result.data.total_count + ")");

    }

    function getBaseUrl() {
        console.log('Protocol: ' + window.location.protocol);
        console.log('Port: ' + window.location.port);
        console.log('Host: ' + window.location.hostname);
        console.log('Path: ' + window.location.pathname);

        // construct baseurl
        var baseUrl = window.location.protocol + '//' + window.location.hostname;
        baseUrl += window.location.port.length > 0 ? ':' + window.location.port : '';
        //baseUrl += window.location.pathname; // do not add the path

        console.log('Base URL: ' + baseUrl);

        return baseUrl;
    }

    // Construct search API URL from parts, with query params, paging params etc. etc.
    // Note that in the new frontend SPA the URL could be different and not Solr like... so this should be adapted
    function constructSearchApiUrl(baseUrl) {
        // get the current url
        let url = window.location.href;
        console.log('URL: ' + url);
        // get the search part
        let search = window.location.search;
        console.log('Search: ' + search);
        // get the query params
        let params = new URLSearchParams(search);
        console.log('Params: ' + params);

        // Extract and reuse any fq (filter queries) params to filter on       
        // construct new params object for filter queries
        var newParams = new URLSearchParams();
        // first just add all fq params, copy action
        params.getAll('fq').forEach(fq => newParams.append('fq', fq));
        // get fq0, fq1 etc. (from facet selection) from the params and add to the search query
        for (let i = 0; i <= 9; i++) {
            if (params.has(`fq${i}`)) {
                // map to fq without number, API only can handle that one
                newParams.append('fq', params.get(`fq${i}`));
            }
        }
        console.log('New params: '+ newParams);

        // TODO: use newParams instead of string concatenation below

        var q = '*'; // make sure we have a query, default is '*', API needs it
        if (params.has('q') && params.get('q').length > 0) {
            q = params.get('q');
        }

        // TODO: extract and reuse any sort params to sort on

        var apiUrl = baseUrl + '/api/search' + '?' + 'q=' + q;
        apiUrl += '&type=dataset'; // only datsets when trying to get all datasets
        // But if we want to sync with the current search paging we should uset files and verses if specified
        //var type = params.get('type'); // and the Dataverse default value

        // add the new params to the url
        apiUrl += '&' + newParams.toString();

        // assume first page of root verse, should be retrieved from the url
        //var start = 0;
        //var pageSize = 10; // default pagesize in dataverse is 10, but we could use more
        var subtree = 'root';
        apiUrl += "&start=" + start + "&per_page=" + pageSize + "&subtree=" + subtree;

        // add params specific for archaeology custom metadata
        apiUrl += '&metadata_fields=dansTemporalSpatial:*';

        console.log('New URL: ' + apiUrl);

        return apiUrl;
    }

    function hasDatasetType() {
        // get the current url
        let url = window.location.href;
        console.log('URL: ' + url);
        // get the search part
        let search = window.location.search;
        console.log('Search: ' + search);
        // get the query params
        let params = new URLSearchParams(search);
        console.log('Params: ' + params);

        // check if types is specified
        if (params.has('types') ) {
            var types = params.get('types');
            console.log('Types: ' + types);
            if (types.includes('dataset')) {
                return true;
            } else {
                return false;
            }
        } else {
            return true;
        }
    }

    function createTabSelection() {
        // PrimeFaces... trying to get look-and-feel right is cumbersome !
        // Note: get hover effect right needed to handle the hover event on the li
        var tabs = $('<div id="searchResultsViewTab" class="ui-tabs ui-widget ui-widget-content ui-corner-all ui-hidden-container ui-tabs-top"></div>')
        // remove border-bottom
        tabs.css('border-bottom', '0px');

        var nav_tabs = $('<ul class="ui-tabs-nav ui-helper-reset ui-widget-header ui-corner-all" role="tablist"></ul>')
        
        var list_tab = $('<li class="ui-tabs-header ui-state-default ui-tabs-selected ui-state-active ui-corner-top" role="tab" tabindex="0" aria-expanded="true" aria-selected="true"><a href="" id="list-tab"  aria-controls="list"> List</a></li>');
        nav_tabs.append(list_tab);
        var list_icon = $(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-list-task" viewBox="0 0 16 16">
                <path fill-rule="evenodd" d="M2 2.5a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5V3a.5.5 0 0 0-.5-.5zM3 3H2v1h1z"/>
                <path d="M5 3.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5M5.5 7a.5.5 0 0 0 0 1h9a.5.5 0 0 0 0-1zm0 4a.5.5 0 0 0 0 1h9a.5.5 0 0 0 0-1z"/>
                <path fill-rule="evenodd" d="M1.5 7a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5H2a.5.5 0 0 1-.5-.5zM2 7h1v1H2zm0 3.5a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zm1 .5H2v1h1z"/>
            </svg>`);
        list_tab.find('a').prepend(list_icon);

        var map_tab = $('<li class="ui-tabs-header ui-state-default ui-corner-top" role="tab" tabindex="0" aria-expanded="false" aria-selected="false"><a href="" id="map-tab" aria-controls="map" aria-selected="false"> Map</a></li>'); 
        nav_tabs.append(map_tab);

        var map_icon = $(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-map" viewBox="0 0 16 16">
                <path fill-rule="evenodd" d="M15.817.113A.5.5 0 0 1 16 .5v14a.5.5 0 0 1-.402.49l-5 1a.5.5 0 0 1-.196 0L5.5 15.01l-4.902.98A.5.5 0 0 1 0 15.5v-14a.5.5 0 0 1 .402-.49l5-1a.5.5 0 0 1 .196 0L10.5.99l4.902-.98a.5.5 0 0 1 .415.103M10 1.91l-4-.8v12.98l4 .8zm1 12.98 4-.8V1.11l-4 .8zm-6-.8V1.11l-4 .8v12.98z"/>
            </svg>`);
        map_tab.find('a').prepend(map_icon);

        tabs.append(nav_tabs);
        return tabs;
    }

    // construct the html elements for the mapview
    // note that we fixed the height of the map to 480px; was 320px (better for sideview)
    function createMapViewDiv() {
        var mapviewDiv = $('<div id="mapview"></div>');

        var controls = $('<p>Geographic location of datasets: </p>');
        controls.append('<span id="result-totals"></span>');
        //controls.append('<input id="btnSubmit-searchLocation" type="submit" value="Start Retrieving" />');

        var spinner = $('<span id="spinner-searchLocation" style="display:none;"></span>');
        //spinner.append('<span class="spinner-border" role="status" style="width: 1.2rem; height: 1.2rem;" ><span class="sr-only">Loading...</span></span>');
        // Note that we use a resource from the dataverse web application
        spinner.append('<span>Loading...</span><img src="/resources/images/ajax-loading.gif" style="width: 1.2em; height: 1.2em;" />');

        controls.append(spinner);
        controls.append('<div id="progress"><div id="progress-bar"></div></div>');

        mapviewDiv.append(controls);
        mapviewDiv.append('<div id="geomap" style="height:480px;"></div>');

        return mapviewDiv;
    }


    /**
     * Assumes to get a JSON search result from the Dataverse API
     * and this is from the archaeology data station with the dansTemporalSpatial metadata block
     */
    const extractFeatures = (result) => {
        const t0 = performance.now();
        var resultFeatureArr = [];

        console.log('Total of items in this page: ' + result.data.items.length);

        $.each(result.data.items, function (key, value) {
            console.log('Processing item: ' + value.name);
            if (typeof value.metadataBlocks !== "undefined" &&
                typeof value.metadataBlocks.dansTemporalSpatial !== "undefined") {
                let authors   = value.authors.map(x => x).join(", ");
                let publication_date = value.published_at.substring(0, 10); // fixed format
                console.log('Authors: ' + authors + '; Publication date: ' + publication_date);

                dansSpatialPoint = value.metadataBlocks.dansTemporalSpatial.fields.find(x => x.typeName === "dansSpatialPoint");
                let title = "<span><a href='" + value.url + "' target='_blank'>" + value.name + "</a></span>";
                let location = ""; //nothing
                // Only points for now!
                if (typeof dansSpatialPoint !== "undefined") {
                    dansSpatialPointX = dansSpatialPoint.value[0]["dansSpatialPointX"].value
                    dansSpatialPointY = dansSpatialPoint.value[0]["dansSpatialPointY"].value
                    // Check the schema of the dansSpatialPointX and dansSpatialPointY
                    // dansSpatialPointScheme value = "RD (in m.)", yes a literal string!
                    if (dansSpatialPoint.value[0]["dansSpatialPointScheme"].value !== "RD (in m.)") {
                        console.log('Spatial point scheme not in RD, but in: ' + dansSpatialPoint.value[0]["dansSpatialPointScheme"].value);
                        return; // skip this one
                    }
                    // calculate lat, lon in WGS84, assuming new RD in m.
                    latLon = convert(parseFloat(dansSpatialPointX), parseFloat(dansSpatialPointY))
                    lat = latLon.lat;
                    lon = latLon.lon;
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
                            "publication_date": publication_date,
                            "id": value.global_id
                        }
                    }
                    //console.log(feature);
                    resultFeatureArr.push(feature);
                }
            }
        });
        const t1 = performance.now();
        console.log(`Call to extractFeatures took ${t1 - t0} milliseconds.`);
        return resultFeatureArr;
    }

    /** Note that I copied this next convert function from somewhere on the web, 
     * ignoring any errors and not having it validated in any way 
     * copy from https://github.com/glenndehaan/rd-to-wgs84/blob/master/src/index.js
     */
    /**
     * Converts the Dutch 'RD' RijksDriehoek coordinate system to standard WGS84 (GPS) coordinates
     *
     * @param x
     * @param y
     * @return 
     */
    const convert = (x, y) => {
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
            error: null,
            lat: fWgs,
            lon: lWgs
        }
    };
}