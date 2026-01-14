# 
# Generate test coordinates_data for the experiments

import datetime
import os
import uuid
import numpy as np
import argparse
import jinja2
import requests


# Note that we do not use pyDataverse, simple post requests is all we need

def create_dataset(api_token, server_url, parent, dataset_json):
    response = requests.post(server_url + '/api/dataverses/' + parent + '/datasets', 
                  headers={'X-Dataverse-key':api_token, 'Content-type':'application/json'}, 
                  data=dataset_json)

    # show all information when not successful
    if response.status_code != 201:
        print(response.text)
    response.raise_for_status()
        
    return response.json()


def publish_dataset(api_token, server_url, pid):
    response = requests.post(server_url + '/api/datasets/:persistentId/actions/:publish', 
                            headers={'X-Dataverse-key': api_token},
                            params={'persistentId': pid, 'type': 'major'})

    response.raise_for_status()
    return response.json()


# Generate test coordinates_data; for the DataverseNL Datastation in WGS84 Coordinates
# By default is will generate 2D points, 
# only when d=4 it generates four coordinates resembling a (bounding) box
# the name 'd' suggest dimension, but all is 2D for now
def generate_WGS84_coordinates_data(n, d):
    # generate coordinates_data, random uniform distribution on [0, 1]
    #d = 2 # fixed to 2D points
    coordinates_data = np.random.rand(n, d)
    # scale and shift coordinates_data to match (almost) valid WGS84 coordinates
    # Longitude [-180,180], Latitude [-90,90]
    
    # Note that RD had Lon/lat and WGS84 Lat/Lon ...

    # Latitude or NORTH
    coordinates_data[:, 0] *= 180.0
    coordinates_data[:, 0] -= 90.0

    # Longitude or EAST
    coordinates_data[:, 1] *= 360.0
    coordinates_data[:, 1] -= 180.0

    if d == 4:
        # SOUTH
        coordinates_data[:, 2] *= 180.0
        coordinates_data[:, 2] -= 90.0

        # WEST
        coordinates_data[:, 3] *= 360.0
        coordinates_data[:, 3] -= 180.0

    return coordinates_data


# main program
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Generate test datasets for the experiments')
    parser.add_argument('-url', type=str, default='https://dev.dataverse.nl', help='Server URL')
    parser.add_argument('-n', type=int, default=1, help='Number of datasets')
    parser.add_argument('-a', type=str, help='API token', required=True)
    parser.add_argument('-i', help='ignore self signed certificate', action='store_false')
    # output is not used now
    parser.add_argument('--output', type=str, default='testdata_pids.txt', help='Output file')
    args = parser.parse_args()
    #print(args)
    
    # Create a session with your desired settings
    session = requests.Session()
    session.verify = args.i  # ignore self-signed certificates if specified

    # Monkey-patch requests' top-level methods to use the session
    requests.get = session.get
    requests.post = session.post
    requests.put = session.put
    requests.delete = session.delete
    requests.head = session.head
    requests.patch = session.patch

    # TODO: parse from command line
    parent = 'dccd' #'root'
    server_url = args.url
    api_token = args.a 
    n = args.n
    output = args.output

    id = str(uuid.uuid4())
    timestamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")   
    
    # determine location of this python file
    path = os.path.dirname(os.path.realpath(__file__))

    # Using a template engine to generate json was simpler that using the json module and traversing the hierarchy
    with open(path + '/dccd_dataset_json.j2', 'r') as f:
         template = jinja2.Template(f.read())

    for i in range(n):
        # one point only for DCCD datasets
        content = template.render(title=f'Test DCCD dataset {str(i)}  with 1 point location {id}',
                                  keyword=f'maptest {timestamp}',
                                  point=generate_WGS84_coordinates_data(1, 2)[0],  # generate point with 2 dimensions
                                  )
        
        #with open('experiments/testdata/'+ 'dataset_json_'+str(i)+'.json', 'w') as f:
        #    f.write(content)
        result = create_dataset(api_token, server_url, parent, content)
        #print(result)
        print("Id: {} PID: {}".format(result['data']['id'], result['data']['persistentId']))
        # publish
        pid = result['data']['persistentId']
        result = publish_dataset(api_token, server_url, pid)
        print(result)

# TODO: save the dataset id and pid to a file for later use; like destroy
# Example bash script to destroy datasets, 24 to 33
# for id in {24..33}; 
#   do echo $i; 
#   curl -H "X-Dataverse-key: $API_TOKEN" -X DELETE "$SERVER_URL/api/datasets/$id/destroy";
# done
