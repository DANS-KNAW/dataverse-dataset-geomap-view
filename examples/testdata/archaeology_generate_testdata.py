# 
# Generate test coordinates_data for the experiments

import datetime
import os
import uuid
import numpy as np
import argparse
import jinja2
import requests

# jinja2 template for the test coordinates_data
test_template = '''\
some point coordinates_data for the experiments with the following properties:  
- number of coordinates_data points: {{ n }}
- coordinates_data points are generated randomly from the uniform distribution on [0, 1]
- coordinates_data points are stored in a text file with the following format: 
    - each row corresponds to a coordinates_data point  
    - each column corresponds to a dimension of the coordinates_data point
    - coordinates_data points 
    {% for point in coordinates_data %}
    {{ point[0]|int}}, {{ point[1]|int }}
    {% endfor %}
- the coordinates_data file is named {{ output }}
    
'''

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


# Generate test coordinates_data; for the Archaeology Datastation in RD Coordinates
# By default is will generate 2D points, 
# only when d=4 it generates four coordinates resembling a (bounding) box
# the name 'd' suggest dimension, but all is 2D for now
def generate_coordinates_data(n, d):
    # generate coordinates_data, random uniform distribution on [0, 1]
    #d = 2 # fixed to 2D points
    coordinates_data = np.random.rand(n, d)
    # scale and shift coordinates_data to match (almost) valid RD coordinates
    # https://nl.wikipedia.org/wiki/Rijksdriehoeksco%C3%B6rdinaten
    # " de x-coördinaat tussen 0 en 280 km ligt en de y-coördinaat tussen 300 en 625 km."
    
    # X or EAST
    coordinates_data[:, 0] *= 280000
    # Y or NORTH
    coordinates_data[:, 1] *= 325000
    coordinates_data[:, 1] += 300000
    if d == 4:
        # WEST
        coordinates_data[:, 2] *= 280000
        # SOUTH
        coordinates_data[:, 3] *= 325000
        coordinates_data[:, 3] += 300000
    # floor to integer (meters in RD coordinates)
    coordinates_data = np.floor(coordinates_data)
    return coordinates_data


# main program
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Generate test datasets for the experiments')
    parser.add_argument('-url', type=str, default='https://dev.archaeology.datastations.nl', help='Server URL')
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
    parent = 'root'
    server_url = args.url
    api_token = args.a 
    n = args.n
    output = args.output

    id = str(uuid.uuid4())
    timestamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")   
    
    # determine location of this python file
    path = os.path.dirname(os.path.realpath(__file__))

    # Using a template engine to generate JSON was simpler than using the json module and traversing the hierarchy
    with open(path + '/dataset_json_archaeology.j2', 'r') as f:
         template = jinja2.Template(f.read())

    for i in range(n):
        nr_of_points = np.random.randint(0, 4)
        if nr_of_points == 0:
            nr_of_boxes = np.random.randint(1, 3) # at least one box when there are no points
        else:
            nr_of_boxes = np.random.randint(0, 3)
        content = template.render(title=f'Test dataset {str(i)}  with {nr_of_points} point{"" if nr_of_points == 1 else "s"} and {nr_of_boxes} box{"" if nr_of_boxes == 1 else "es"} {id}',
                                  keyword=f'maptest {timestamp}',
                                  points=generate_coordinates_data(nr_of_points, 2),  # generate points with 2 dimensions
                                  boxes=generate_coordinates_data(nr_of_boxes, 4)) # generate boxes with 4 coordinates, could be interpreted as two points
        
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
