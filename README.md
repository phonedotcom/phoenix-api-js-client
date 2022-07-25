
# JavaScript Client for api.phone.com.

## Description

This package is supposed to simplify usage of [Phone.com](https://www.phone.com/) API in front-end applications.

Api documentation can be found [here](https://apidocs.phone.com/).

## Installation

Using npm:
```shell
$ npm i phoenix-api-js-client
```
_Note: add  `--save` if you are using npm < 5.0.0_

## Usage

### Initialization

```javascript
// 1. Import the package:
const PhoenixClient = require('phoenix-api-js-client');

// 2. Define options
const options = {
    client_id: null,
    handle_rate_limit: true,
    handle_server_error: 3,
    scope: ["account-owner"],
    session_name: "phoenix-api-js-client-session",
    id_token_sign_out: false,
    decode_id_token: false,
    session_scope: 'tab',
};

// 3. Create client object
const phoenix_client = new PhoenixClient(options);

// 4. Load user
phoenix_client.init_user().then(authorized => {
  if (authorized) {
      // 5. Make a request
      phoenix_client.get_list('/messages')
        .then(console.log)
        .catch(console.error);
  } else {
    console.log('We can redirect user to the login form');
  }
}).catch(console.error);
```

### Options

- ***client_id*** : string,  ***required*** default null; your api account client id
- ***handle_rate_limit***: boolean, default: true; If you send too much requests in certain period of time, it will throw 429 error. Enabling this option, this will wait for the response specified time and it will resend the same request. Logs the message in the console. Disabling this option, it immediately throws the 429 error.
- ***handle_server_error***: false or unsigned integer, default: 3; Specifies the number of retries if the server responds with 500+ error (500, 501, 502 etc). Logs error in the console.  Disabling this option, it immediately throws the error.
- ***scope***: array, default: ["account-owner"]; scopes for users, possible values: account-owner, extension-user, call-logs, billing-api, oauth-management, openid.
- ***session_name***: string, default: "phoenix-api-js-client-session"; session name for authenticated users.
- ***id_token_sign_out***: boolean, default: false; if openid scope is used, this option confirms that you want to use id_token for signing out.
- ***decode_id_token***: boolean, default: false; if openid scope is used, this option enabled will decode your id_token and validate its signature. As result it will return id_token's payload or null.
- ***session_scope***: string, in: ['tab', 'browser'], default: 'tab'; defines how data is stored, 'tab' - uses sessionStorage (phoenix-api-js-client is available per tab), 'browser' - uses localStorage (phoenix-api-js-client data is shared across browser windows and tabs).

### Client methods

Client object implements some methods you can use:

| method | args | description |
|--|--|--|
| oauth_url | property | generates sign-in uri. User now can sign in by filling the form, which response will return Bearer token needed for the [OAuth 2.0](https://tools.ietf.org/html/rfc6749). If you use token based authentication, please skip this step.
| init_user |  | sets up the user for the session.
| _load_user | token: string, uses_token: boolean | sets up the user for the session. If uses_token is true, token will not be deleted from the account on sign out
| sign_out |  | sings out the user
| create_item | uri: string, required; data: object, required | Sends POST request to create the item
| get_item | uri: string, required | returns the item specified in the uri.
| get_list | uri: string, required; limit: unsigned integer, max:500; offset: unsigned integer; global: boolean |  Returns items limited by limit argument, with offset of offset argument
| get_list_all | uri: string, required | returns all items (specified in the uri) from the account
| patch_item | uri: string, required; data: object, required | Sends PATCH request to update the item specified in the uri
| replace_item | uri: string, required; data: object, required | Sends PUT request to update the item specified in the uri
| download_item | uri: string, required | Downloads the item specified in the uri. 
| delete_item | uri: string, required | Deletes the item specified in the uri. 
