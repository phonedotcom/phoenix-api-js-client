
# JavaScript Client for api.phone.com.

## Description
This package is supposed to simplify usage of [Phone.com](https://www.phone.com/) API in front-end applications.
Api documentation can be found [here](https://apidocs.phone.com/).

## Instalation
Using npm:
```shell
$ npm i phoenix-api-js-client
```
Note: add  `--save`  if you are using npm < 5.0.0

## Usage
import the package:
```shell
const phoenix = require('phoenix-api-js-client');
```
This will provide you access to PhoenixApiClient class. Its constructor receives object with options. Default options are:
```shell
options = {
    client_id: null,
    handle_rate_limit: true,
    handle_server_error: 3,
    scope: ["account-owner"],
    session_name: "phoenix-api-js-client-session",
  };
```

 - ***client_id*** : string,  ***required*** default null; your api account client id


- ***handle_rate_limit***: boolean, default: true; If you send too much requests in certain period of time, it will throw 429 error. Enabling this option, this will wait for the response specified time and it will resend the same request. Logs the message in the console. Disabling this option, it immediately throws the 429 error.
- ***handle_server_error***: false or unsigned integer, default: 3; Specifies the number of retries if the server responds with 500+ error (500, 501, 502 etc). Logs error in the console.  Disabling this option, it immediately throws the error.
- ***scope***: array, default: ["account-owner"]; session name for authenticated users.
- ***session_name***: string, default: "phoenix-api-js-client-session"; scopes for users, possible values: account-owner, extension-user, call-logs, billing-api, oauth-management.

After creating this class object, it will give you access to its method. First of them you will probably use are:

|method  | args |description |
|--|--|--|
| .get_auth_link |  |  generates sign-in uri. User now can sign in by filling the form, which response will return Bearer token needed for the [OAuth 2.0](https://tools.ietf.org/html/rfc6749). If you use token based authentication, please skip this step. 
| .load_user  |token (string) **required** |  accepts Bearer token, always starts with Bearer. Sets up the user for the session.

You are now ready to use all of other methods.
|method  | args |description |
|--|--|--|
|sign_out  |  |  sings out the user
| create_item | uri: string, required; data: object, required | Sends POST request to create the item
|get_item  | uri: string, required | returns the item specified in the uri.
| get_list | uri: string, required; limit: unsigned integer, max:500; offset: unsigned integer; global: boolean |  Returns items limited by limit argument, with offset of offset argument and  if global is true looks generaly on the website, if false, looks on the authenticated user account.
| get_list_all | uri: string, required |  returns all items (specified in the uri) from the account
| patch_item | uri: string, required; data: object, required | Sends PATCH request to update the item specified in the uri
| replace_item | uri: string, required; data: object, required | Sends PUT request to update the item specified in the uri
| download_item | uri: string, required | Downloads the item specified in the uri. 
| delete_item | uri: string, required | Deletes the item specified in the uri. 
