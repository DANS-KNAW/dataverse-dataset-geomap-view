Developer notes
===============

The JavaScript code is based on the functionality of Dataverse version 6.2+, and is uses the jQuery and the Leaflet geographical map library. 
When the `DvDatasetGeoMapViewer` function is called, from a script tag in the custom footer, the default 'list' display is accompanied (via a 'Map' tab) on geographical map showing the datasets with locations as markers. 

Besides showing maps for the search results, there are also maps in the Dataset (view) page when coordinates are specified. 
Smaller maps will appear next to the points and or boundingboxes coordinates of the custom metadata block. There will also be a larger (wider) map just above the tabs, showing both points and boundingboxes. 

## Short description of the solution: 

The script in that custom footer is kicking in with a search results page load (default the homepage shows the top 10 in a list). 

Map display: 
 - Initially the script extracts search parameters from the page URL. 
 - It uses that to get results from the (public) search API, but then also requests to include the location information. 
 - It will transform it to markers with pop-ups on the map. 
   When markers are selected the popup appears with the datasets title as a link to the dataset landing page. 

With tabs it does the following: 
 - Initially the script tries to get the previously stored Tab selection. 
   Default is the List tab, showing the list of paged results. 
 - When the Map tab is selected it will show the map and hide the list results. 
 - If the List tab is selected it will hide the map and show te list. 
 - The tab selection is stored so when the page is reloaded, because of a search change, the map stays selected if it was or the list stays selected. 


## Instructions for DANS developers

Using the development setup we have at DANS for our Archaeology Datastation, with vagrant and VirtualBox VM's. 
However this code/html fragment could be inserted into the custom footer file of the `test` or `demo` servers of `archaeology.datastations.nl`. 

The example[custom footer file](../examples/custom-footer.html) is in this repo. 

Steps for developers with access to on the `dans-core-systems` repo:
1. Get into the repo directory (assuming you have everything in place for the standard development). 
2. Start the archaeology dev box with `start-preprovisioned-box.py dev_vocabs dev_archaeology`.
3. Copy the custom footer file into the `dans-core-systems/shared` dir. 
4. SSH into the dev box with `vagrant ssh dev_archaeology`.
5. Set the custom footer to point to that `/vagrant/shared` folder: `curl -X PUT -d '/vagrant/shared/custom-footer.html' http://localhost:8080/api/admin/settings/:FooterCustomizationFile`. 
6. The `dv-dataset-geomap-view-<version>.js` file must be placed on the VM in `/var/www/html/custom/geomapview`. 

When you edit that custom footer file in the `shared` directory just a browser page reload would be enough to see the difference. If you edit it in this git repo, then copy it to that shared directory after every change. Use the browser debugger/inspection tool to see those console messages and or any errors occurring. 

When editing the js file, you need two copy actions:
- firsts into that `shared` dir (unless you clone the repo in there).
- next on the vagrant box into that `/var/www/html/custom/geomapview` folder. 

## Deployment 

While developing, we have caching disabled in the browser, but when deploying on a server we do want to use versions numbers in the filename to force the browser to use the new version. We should add that file to the GitHub release 'assets' for convenience. 
Use the same version as the release tag!
At some point we could have a 'build' step that uses the version to rename the output file. It could even do some JS minifying if we used a build tool for that. 

## Possible functional improvements:

- Extract and display locations from more than 1000 datasets. Current limit comes from the search API call, getting more results has to be done with more API requests.  Allow to retrieve more via an extra GUI control with progress bar. 

- Make the script more general usable; for others that have geographical coordinates in their custom metadata. 

- Enhancing the appearance of the marker popup with thumbnail or icon similar to what is done on the result listing. 

- Allow selection of alternative base maps, like a satellite image. 

- Allow downloading the geographical information on the map in GeoJSON format.

## Tests 

For testing purposes a Python script is provided that allows to add datasets with coordinates to the archive. This can be found in [the testdata folder](../examples/testdata). 
Also, some stress testing has been done, the results and the JMeter file is provided in [the stresstests folder](../examples/testdata/stresstests). 
