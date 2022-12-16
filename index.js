const axios = require("axios");
const jwkToPem = require("jwk-to-pem");
const jws = require("jws");

/** Class representing a PhoenixApi client. */
class PhoenixApiClient {

  /**
   * Create a PhoenixApiClient.
   * @param {object} options - objects that updates class options
   */
  constructor(options = {}) {
    this.user = null;
    this.token = null;
    this.uses_token = false;
    this._id_token = null;
    this._decoded_id_token = null;
    this.expiration_timeout = 0;

    this.options = {
      client_id: null,
      handle_rate_limit: true,
      handle_server_error: 3,
      scope: ["account-owner"],
      session_name: "phoenix-api-js-client-session",
      id_token_sign_out: false,
      decode_id_token: false,
      ignore_state: false,
      session_scope: "tab",
    };
    if (!["tab", "browser"].includes(options.session_scope)) options.session_scope = "tab";
    Object.assign(this.options, options);
    this.listeners = {
      "logged-out": null,
      "session-expired": null,
      "error": null,
    };
  }

  set id_token(val) {
    this._id_token = val;
    val ? this._setItem(this.id_token_cache_key, val) : this._removeItem(this.id_token_cache_key);
  }

  get id_token() {
    if (this._id_token) return this._id_token;
    if (this.user && this._getItem(this.id_token_cache_key)) {
      return this._getItem(this.id_token_cache_key);
    }

    return null;
  }

  set decoded_id_token(val) {
    this._decoded_id_token = val;
    val ? this._setItem(this.decoded_id_token_cache_key, JSON.stringify(val)) : this._removeItem(this.decoded_id_token_cache_key);
  }

  get decoded_id_token() {
    if (this._decoded_id_token) return this._decoded_id_token;
    if (this.user && this._getItem(this.decoded_id_token_cache_key)) {
      return JSON.parse(this._getItem(this.decoded_id_token_cache_key));
    }

    return null;
  }

  get decoded_id_token_cache_key() {
    return `${this.id_token_cache_key}-decoded`;
  }

  get id_token_cache_key() {
    return `${this.options.session_name}-id-token-${this.user.id}`;
  }

  /**
   * Initializes user
   * @return {Promise<boolean>}
   */
  async init_user() {
    let user = this._getItem(this.options.session_name);
    if (user) user = JSON.parse(user);
    if (!(user && (await this.set_user(user)))) {
      await this._oauth();
    }
    return !!this.user;
  }

  /**
   * Checks if URI's hash contains access token
   * @return {boolean} - if token is found - true, else false
   */
  async _oauth() {
    if (this.user) return true;
    const parse_query = (hash_string) => {
      const hash = hash_string
        .substr(1)
        .split("&")
        .filter((v) => !!v.length)
        .map((v) => v.split("="));
      const hashObject = {};
      for (let i of Object.keys(hash)) {
        hashObject[decodeURIComponent(hash[i][0])] = decodeURIComponent(
          hash[i][1]
        );
      }
      return hashObject;
    };
    if (document.location.hash.includes("token_type=Bearer")) {
      const hashObject = parse_query(document.location.hash);
      if (!this.options.ignore_state && this._state !== hashObject["state"]) {
        console.warn('"state" parameter doesn\'t match');
        return false;
      }
      this.token = `${hashObject["token_type"]} ${hashObject["access_token"]}`;
      await this._load_user(this.token);
      if (hashObject["id_token"] && this.options.scope.includes('openid')) {
        this.id_token = hashObject["id_token"];
        if (this.options.decode_id_token) this.decoded_id_token = await this.decode_id_token();
      }
      return true;
    }
    return false;
  }

  /**
   * Returns state for OAuth
   * @return {string} state
   */
  get _state() {
    const state_storage_key = `${this.options.session_name}_state`;
    let state;
    if (localStorage.getItem(state_storage_key)) {
      state = localStorage.getItem(state_storage_key);
    } else {
      state = Math.floor(Math.random() * 10000000).toString();
      localStorage.setItem(state_storage_key, state);
    }
    return state;
  }

  /**
   * Handles rate limit if enabled in the constructor options.
   * @param {object} err - The error object returned from he API
   * @param {function} callback - the method that will be executed right after rate limit ends
   * @return {Promise} result of resent request
   */
  handle_rate_limit(err, callback) {
    const seconds = err.data["@error"]["@rateLimit"]["Retry-After"] || 1;
    console.warn(`Too much requests. Retry after ${seconds}s`);
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        callback()
          .then(resolve)
          .catch(reject);
      }, seconds * 1000);
    });
  }

  /**
   * Handles internal server errors if enabled in the constructor options.
   * @param {object} err - The error object returned from he API
   * @param {function} callback - the method that will be executed after 500ms
   * @return {Promise} result of resent request
   */
  handle_internal_server_error(err, callback) {
    console.warn("Internal server error. Retrying...", err);
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        callback()
          .then(resolve)
          .catch(reject);
      }, 500);
    });
  }

  /**
   * Loads the user by the Bearer token, sets session expiration time
   * @param {string} token - Bearer token
   * @param {number} _attempt - attempt number (used for retries limitation)
   */
  async _load_user(token, uses_token = false, _attempt = 1) {
    try {
      this.uses_token = uses_token;
      const response = await this.call_api('get', "/v4/oauth/access-token", null, true, {}, token);
      history.pushState(
        "",
        document.title,
        `${window.location.pathname}${window.location.search}`
      );
      await this.set_user({
        id: response.data["scope_details"][0]["voip_id"],
        token: token,
        expiration: response.data["expires_at"]
          ? response.data["expires_at"] * 1000
          : null,
      });
    } catch (e) {
      const err = e.response;
      if (err.status === 429 && this.options.handle_rate_limit) {
        await this.handle_rate_limit(err, async () => {
          await this._load_user(token, _attempt);
        });
      }
      if (
        err.status >= 500 &&
        err.status <= 599 &&
        this.options.handle_server_error &&
        _attempt <= this.options.handle_server_error
      ) {
        await this.handle_internal_server_error(err, async () => {
          _attempt++;
          return await this._load_user(token, _attempt);
        });
      }
      throw err;
    }
  }

  /**
   * Signs out the authenticated user
   */
  async sign_out(session_expired = false) {
    try {
      if (this.options.id_token_sign_out && this.options.scope.includes('openid') && this.id_token) {
        await this.delete_access_token();
        this.openid_endsession(session_expired);
      } else {
        await this.delete_access_token();
        this.post_sign_out(session_expired);
      }
    } catch (err) {
      console.log(err);
    }
  }

  /*
  * Cleans cache and calls logged-out callback if provided
  */
  post_sign_out(session_expired) {
    this.user = null;
    this._removeItem(this.options.session_name);
    if (this.listeners["logged-out"] && !session_expired)
      this.listeners["logged-out"]();
  }

  /**
   * Goes to openid endsession route and comes back to project root route
   */
  openid_endsession(session_expired) {
    const redirect = `${document.location.protocol}//${document.location.host}`;
    const uri = `https://oauth-api.phone.com/connect/endsession?id_token_hint=${encodeURIComponent(this.id_token)}&post_logout_redirect_uri=${encodeURIComponent(redirect)}`;
    this.id_token = null;
    this.decoded_id_token = null;
    this.post_sign_out(session_expired);

    window.location.assign(uri);

    return true;
  }

  /**
   * Deletes current access token
   * @param {number} _attempt - attempt number (used for retries limitation)
   * @return {object} response object.
   */
  async delete_access_token(_attempt = 1) {
    try {
      if (this.uses_token) return true;
      const url = this._phoenix_url("/v4/oauth/access-token", true);
      const headers = this._phoenix_auth_headers();
      const item = await axios.delete(url, { headers }); 
      return item.data;
    } catch (e) {
      const err = e.response;
      if (err.status === 401) {
        return null;
      }
      if (err.status === 429 && this.options.handle_rate_limit) {
        return await this.handle_rate_limit(err, async () => {
          return await this.delete_access_token(_attempt);
        });
      }
      if (
        err.status >= 500 &&
        err.status <= 599 &&
        this.options.handle_server_error &&
        _attempt <= this.options.handle_server_error
      ) {
        await this.handle_internal_server_error(err, async () => {
          _attempt++;
          return await this.delete_access_token(_attempt);
        });
      }
      if (this.listeners["error"]) this.listeners["error"](err);

      throw err;
    }
  }

  on(eventname, callback) {
    this.listeners[eventname] = callback;
  }

  /**
   * Signs out the user with expired session
   */
  async handle_expired_session() {
    await this.sign_out(true);
    if (this.listeners["session-expired"]) this.listeners["session-expired"]();
  }

  /**
   * Performs check if user expiration date is passed
   */
  _session_expired() {
    return (this.expiration_timeout - Date.now() - 10000) < 0;
  }

  /**
   * Sets the user for the session, sets session expiration time
   * @param {object} user - object with user id, token and expiration time
   */
  async set_user(user) {
    this.user = user;
    if (user["expiration"]) {
      this.expiration_timeout = user["expiration"];
      if (this._session_expired()) {
        await this.handle_expired_session();
      } else {
        this._setItem(
          this.options.session_name,
          JSON.stringify(user, null, 2)
        );
        const max_timeout = 2147483647;
        const timeout = user["expiration"] - Date.now() - 10000;
        if (timeout > max_timeout) {
          timeout = max_timeout;
        }
        setTimeout(await this.handle_expired_session.bind(this), timeout);
      }
    }
  }

  /**
   * Returns sign in page URL for the user
   * @return {string} A _get_auth_link method result.
   */
  get oauth_url() {
    return this._get_oauth_url("", true);
  }

  /**
   * Generates sign in page URL for the user.
   * @param {string} redirect_path - path to the specific redirect page
   * @param {boolean} is_token - specifies is response_type in the uri should be
   * token (if true) or code  (if false)
   * @return {string} sign in uri
   */
  _get_oauth_url(redirect_path, is_token) {
    const redirect = `${document.location.protocol}//${document.location.host}${redirect_path}`;
    return `https://accounts.phone.com/?client_id=${
      this.options.client_id
      }&response_type=${is_token ? "token" : "code"}${this.options.scope.includes("openid") ? encodeURIComponent(" id_token") : ""}&scope=${encodeURIComponent(
      this.options.scope.join(" ")
    )}&redirect_uri=${encodeURIComponent(redirect)}${this.options.ignore_state ? '' : '&state='+this._state}`;
  }

  /**
   * Generates base url for the api calls
   * @param {string} uri - path to specific resource
   * @param {boolean} global - generates URL with "/v4/account/:account_id", true - generates url with "/v4" only
   * @return {string} generated url
   */
  _phoenix_url(uri, global = false) {
    let url = "https://api.phone.com";
    if (!global) {
      url += `/v4/accounts/${this.user["id"]}`;
    }
    return `${url}${uri}`;
  }

  /**
   * Generates headers for API calls.
   * @param {string} token - user token (required if user is not set)
   * @return {object} headers object
   */
  _phoenix_auth_headers(token = "") {
    const token_provided = token && token.length;
    return (this.user && this.user["token"]) || token_provided
      ? {Authorization: token_provided ? token : this.user["token"]}
      : {};
  }

  /**
   * Gets all items specified in the uri.
   * @param {string} uri - target resource uri
   * @param {boolean} global - generates URL with "/v4/account/:account_id", true - generates url with "/v4" only
   * @return {object} object containing all requested items
   */
  async get_list_all(uri, global = false) {
    let all = [];
    let res;
    do {
      res = await this.get_list(
        uri,
        500,
        res ? res["offset"] + res["limit"] : 0,
        global
      );
      all = all.concat(res["items"]);
    } while (res["total"] > all.length && res["items"].length);
    return {
      items: all,
      offset: 0,
      total: all.length,
      limit: all.length,
    };
  }

  /**
   * Gets items specified in the uri.
   * @param {string} uri - target resource uri
   * @param {number} limit - API limit
   * @param {number} offset - API offset
   * @param {boolean} global - generates URL with "/v4/account/:account_id", true - generates url with "/v4" only
   * @param {number} _attempt - attempt number (used for retries limitation)
   * @return {object} object containing requested items
   */
  async get_list(uri, limit = 25, offset = 0, global = false, _attempt = 1) {
    try {
      if (limit && _attempt === 1) {
        uri += uri.includes("?") ? "&" : "?";
        uri += "limit=" + limit;
        if (offset) uri += "&offset=" + offset;
      }
      const r = await this.call_api('get', global ? ('/v4' + uri) : uri, null, global);
      return {
        items: r.data["items"],
        offset: r.data["offset"],
        total: r.data["total"],
        limit: r.data["limit"],
      };
    } catch (e) {
      const err = e.response;
      if (err.status === 429 && this.options.handle_rate_limit) {
        return await this.handle_rate_limit(err, async () => {
          return await this.get_list(uri, limit, offset, global, _attempt);
        });
      }
      if (
        err.status >= 500 &&
        err.status <= 599 &&
        this.options.handle_server_error &&
        _attempt <= this.options.handle_server_error
      ) {
        await this.handle_internal_server_error(err, async () => {
          _attempt++;
          return await this.get_list(uri, limit, offset, global, _attempt);
        });
      }
      throw err;
    }
  }

  /**
   * Gets the item specified in the uri
   * @param {string} uri - target resource uri
   * @param {number} _attempt - attempt number (used for retries limitation)
   * @return {object} response object.
   */
  async get_item(uri, _attempt = 1) {
    try {
      const item = await this.call_api('get', uri);
      return item.data;
    } catch (e) {
      const err = e.response;
      if (err.status === 429 && this.options.handle_rate_limit) {
        return await this.handle_rate_limit(err, async () => {
          return await this.get_item(uri, _attempt);
        });
      }
      if (
        err.status >= 500 &&
        err.status <= 599 &&
        this.options.handle_server_error &&
        _attempt <= this.options.handle_server_error
      ) {
        await this.handle_internal_server_error(err, async () => {
          _attempt++;
          return await this.get_item(uri, _attempt);
        });
      }
      throw err;
    }
  }

  /**
   * Deletes the item specified in the uri
   * @param {string} uri - target resource uri
   * @param {number} _attempt - attempt number (used for retries limitation)
   * @return {object} response object.
   */
  async delete_item(uri, _attempt = 1) {
    try {
      const item = await this.call_api('delete', uri);
      return item.data;
    } catch (e) {
      const err = e.response;
      if (err.status === 429 && this.options.handle_rate_limit) {
        return await this.handle_rate_limit(err, async () => {
          return await this.delete_item(uri, _attempt);
        });
      }
      if (
        err.status >= 500 &&
        err.status <= 599 &&
        this.options.handle_server_error &&
        _attempt <= this.options.handle_server_error
      ) {
        await this.handle_internal_server_error(err, async () => {
          _attempt++;
          return await this.delete_item(uri, _attempt);
        });
      }
      throw err;
    }
  }

  /**
   * Downloads the item specified in the uri
   * @param {string} uri - target resource uri
   * @param {number} _attempt - attempt number (used for retries limitation)
   * @return {object} response object.
   */
  async download_item(uri, _attempt = 1) {
    try {
      const item = await this.call_api('get', uri, null, false, {
        responseType: "blob",
        timeout: 30000
      });
      return item.data;
    } catch (e) {
      const err = e.response;
      if (err.status === 429 && this.options.handle_rate_limit) {
        return await this.handle_rate_limit(err, async () => {
          return await this.download_item(uri, _attempt);
        });
      }
      if (
        err.status >= 500 &&
        err.status <= 599 &&
        this.options.handle_server_error &&
        _attempt <= this.options.handle_server_error
      ) {
        await this.handle_internal_server_error(err, async () => {
          _attempt++;
          return await this.download_item(uri, _attempt);
        });
      }
      throw err;
    }
  }

  /**
   * Sends PUT request to update the item specified in the uri
   * @param {string} uri - target resource uri
   * @param {object} data - data that should be updated
   * @param {number} _attempt - attempt number (used for retries limitation)
   * @return {object} response object.
   */
  async replace_item(uri, data, _attempt = 1) {
    try {
      const item = await this.call_api('put', uri, data);
      return item.data;
    } catch (e) {
      const err = e.response;
      if (err.status === 429 && this.options.handle_rate_limit) {
        return await this.handle_rate_limit(err, async () => {
          return await this.replace_item(uri, data, _attempt);
        });
      }
      if (
        err.status >= 500 &&
        err.status <= 599 &&
        this.options.handle_server_error &&
        _attempt <= this.options.handle_server_error
      ) {
        await this.handle_internal_server_error(err, async () => {
          _attempt++;
          return await this.replace_item(uri, data, _attempt);
        });
      }
      throw err;
    }
  }

  /**
   * Sends PATCH request to update the item specified in the uri
   * @param {string} uri - target resource uri
   * @param {object} data - data that should be updated
   * @param {number} _attempt - attempt number (used for retries limitation)
   * @return {object} response object.
   */
  async patch_item(uri, data, _attempt = 1) {
    try {
      const item = await this.call_api('patch', uri, data);
      return item.data;
    } catch (e) {
      const err = e.response;
      if (err.status === 429 && this.options.handle_rate_limit) {
        return await this.handle_rate_limit(err, async () => {
          return await this.patch_item(uri, data, _attempt);
        });
      }
      if (
        err.status >= 500 &&
        err.status <= 599 &&
        this.options.handle_server_error &&
        _attempt <= this.options.handle_server_error
      ) {
        await this.handle_internal_server_error(err, async () => {
          _attempt++;
          return await this.patch_item(uri, data, _attempt);
        });
      }
      throw err;
    }
  }

  /**
   * Created the resource specified in the uri
   * @param {string} uri - target resource uri
   * @param {object} data - data that should be created
   * @param {number} _attempt - attempt number (used for retries limitation)
   * @return {object} response object.
   */
  async create_item(uri, data, _attempt = 1) {
    try {
      const item = await this.call_api('post', uri, data);
      return item.data;
    } catch (e) {
      const err = e.response;
      if (err.status === 429 && this.options.handle_rate_limit) {
        return await this.handle_rate_limit(err, async () => {
          return await this.create_item(uri, data, _attempt);
        });
      }
      if (
        err.status >= 500 &&
        err.status <= 599 &&
        this.options.handle_server_error &&
        _attempt <= this.options.handle_server_error
      ) {
        await this.handle_internal_server_error(err, async () => {
          _attempt++;
          return await this.create_item(uri, data, _attempt);
        });
      }
      throw err;
    }
  }

  /**
   * Decodes id token, validates the signature
   * @return {object} token payload or null.
   */
  async decode_id_token() {
    if (!this.id_token) {
      console.warn('id_token not found');
      return null;
    }
    try {
      const tokenparts = this.id_token.split('.');
      const header = JSON.parse(atob(tokenparts[0]));
      const payload = JSON.parse(atob(tokenparts[1]));

      const configuration = await axios.get(`${payload.iss}/.well-known/openid-configuration/`);
      const keys = await axios.get(configuration.data.keys);

      const alg = header.alg;
      const key = keys.data.keys.find(x => x.alg === alg);

      if (key) {
        if (!jws.verify(this.id_token, alg, jwkToPem(key))) {
          console.warn('Your id_token could not be validated.')
          return null
        }
        return payload;
      } else {
        console.warn('Matching key could not be found.');
        return null;
      }
    } catch (err) {
      console.warn('Error decoding your ID token.');
      return null;
    }
  }

  /**
   * Method for making custom API call
   * @param method
   * @param uri
   * @param body
   * @param is_uri_global
   * @param options
   * @param token
   * @return {Promise<*>}
   */
  async call_api(method, uri, body = null, is_uri_global = false, options = {}, token = '') {
    try {
      const method_lc = method.toLowerCase();
      const url = this._phoenix_url(uri, is_uri_global);
      const headers = token.length ? this._phoenix_auth_headers(token) : this._phoenix_auth_headers();
      const options_a = {headers, ...options};
      if (method_lc === 'get') {
        return await axios.get(url, options_a);
      } else if (method_lc === 'delete') {
        return await axios[method_lc](url, options_a); 
      } else {
        return await axios[method_lc](url, body || '', options_a);
      }
    } catch (e) {
      const err = e.response;
      if (err.status === 401 && this._session_expired()) {
        await this.handle_expired_session();
        return {
          data: {}
        };
      }
      if (this.listeners["error"]) this.listeners["error"](err);
      throw e;
    }
  }

  /**
   * Method for storing in session/local storage based on this.options.session_scope value
   * @param {string} key
   * @param {string} value
   * @return {boolean} true
   */
  _setItem(key, value) {
    if (this.options.session_scope === 'tab') {
      sessionStorage.setItem(key, value);
    } else {
      localStorage.setItem(key, value);
    }

    return true;
  }

  /**
   * Method for retrieving from session/local storage based on this.options.session_scope value
   * @param {string} key
   * @return {string} retrieved value
   */
  _getItem(key) {
    if (this.options.session_scope === 'tab') {
      return sessionStorage.getItem(key);
    }
    return localStorage.getItem(key); 
  }

  /**
   * Method for removing from session/local storage based on this.options.session_scope value
   * @param {string} key
   * @return {boolean} true
   */
  _removeItem(key) {
    if (this.options.session_scope === 'tab') {
      sessionStorage.removeItem(key);
    } else {
      localStorage.removeItem(key);
    }

    return true;
  }

}

module.exports = PhoenixApiClient;
