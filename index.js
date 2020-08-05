const axios = require("axios");

/** Class representing a PhoenixApi client. */
class PhoenixApiClient {
  user = null;
  token = null;
  state = null;
  options = {
    client_id: null,
    handle_rate_limit: true,
    handle_server_error: 3,
    scope: ["account-owner"],
    session_name: "phoenix-api-js-client-session",
  };

  /**
   * Create a PhoenixApiClient.
   * @param {object} options - objects that updates class options
   */
  constructor(options = {}) {
    Object.assign(this.options, options);
    this.checkState();
    let user = sessionStorage.getItem(this.options.session_name);
    if (user) user = JSON.parse(user);
    user && this.set_user(user);
  }

  /*
   * Checks if uri has token
   * @return {boolean} - if token is found - true, else false
   */
  async init() {
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
      this.token = `${hashObject["token_type"]} ${hashObject["access_token"]}`;

      await this.load_user(this.token);
      return true;
    }

    return false;
  }

  /*
   * Checks if state is in localstorage
   */
  checkState() {
    const state_storage_key = `${this.options.session_name}_state`;
    if (localStorage.getItem(state_storage_key)) {
      this.state = localStorage.getItem(state_storage_key);
    } else {
      this.state = Math.floor(Math.random() * 10000000).toString();
      localStorage.setItem(state_storage_key, this.state);
    }
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
  // TODO instead of constructor use static method INIT
  async load_user(token, _attempt = 1) {
    try {
      const headers = this._phoenix_auth_headers(token);
      const response = await axios.get(
        this._phoenix_url("/oauth/access-token", true),
        { headers: headers }
      );
      history.pushState(
        "",
        document.title,
        `${window.location.pathname}${window.location.search}`
      );
      this.set_user({
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
          await this.load_user(token, _attempt);
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
          return await this.load_user(_attempt);
        });
      }
      throw err;
    }
  }

  /**
   * Signs out the authenticated user
   */
  sign_out() {
    sessionStorage.removeItem(this.options.session_name);
    this.user = null;
    this.options = {
      client_id: null,
      handle_rate_limit: true,
      handle_server_error: 3,
      session_name: "phoenix-api-js-client-session",
    };
    sessionStorage.removeItem(this.options.session_name);
  }

  /**
   * Signs out the user with expired session
   */
  handle_expired_session() {
    alert("You session has expired. Please sign in again.");
    this.sign_out();
  }

  /**
   * Sets the user for the session, sets session expiration time
   * @param {object} user - object with user id, token and expiration time
   */
  set_user(user) {
    this.user = user;
    if (user["expiration"]) {
      const timeout = user["expiration"] - Date.now() - 10000;
      if (timeout < 0) {
        this.handle_expired_session();
      } else {
        sessionStorage.setItem(
          this.options.session_name,
          JSON.stringify(user, null, 2)
        );
        setTimeout(this.handle_expired_session.bind(this), timeout);
      }
    }
  }

  /**
   * Returns sign in page link for the user
   * @return {string} A _get_auth_link method result.
   */
  get_auth_link() {
    return this._get_auth_link("", true);
  }

  /**
   * Generates sign in page link for the user.
   * @param {string} redirect_path - path to the specific redirect page
   * @param {boolean} is_token - specifies is response_type in the uri should be
   * token (if true) or code  (if false)
   * @return {string} sign in uri
   */
  _get_auth_link(redirect_path, is_token) {
    const redirect = `${document.location.protocol}//${document.location.host}${redirect_path}`;
    return `https://oauth.phone.com/?client_id=${
      this.options.client_id
    }&response_type=${is_token ? "token" : "code"}&scope=${encodeURIComponent(
      this.options.scope.join(" ")
    )}&redirect_uri=${encodeURIComponent(redirect)}&state=${this.state}`;
  }

  /**
   * Generates base url for the api calls
   * @param {string} uri - path to specific resource
   * @param {boolean} global - generates URL with "/v4/account/:account_id", true - generates url with "/v4" only
   * @return {string} generated url
   */
  _phoenix_url(uri, global = false) {
    let url = "https://api.phone.com/v4";
    if (!global) {
      url += `/accounts/${this.user["id"]}`;
    }
    return `${url}${uri}`;
  }

  /**
   * Generates headers for API calls.
   * @param {string|null} token - user token (required if user is not set)
   * @return {object} headers object
   */
  _phoenix_auth_headers(token = null) {
    return (this.user && this.user["token"]) || token
      ? {
          Authorization: token ? token : this.user["token"],
          Prefer: "representation=minimal",
        }
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
    } while (res["total"] < all.length && res["items"].length);
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
      if (limit) {
        uri += uri.includes("?") ? "&" : "?";
        uri += "limit=" + limit;
        if (offset) uri += "&offset=" + offset;
      }
      const r = await axios.get(this._phoenix_url(uri, global), {
        headers: this._phoenix_auth_headers(),
      });
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
      const item = await axios.get(this._phoenix_url(uri), {
        headers: this._phoenix_auth_headers(),
      });
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
      const item = await axios.delete(this._phoenix_url(uri), {
        headers: this._phoenix_auth_headers(),
      });
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
      const item = await axios.get(this._phoenix_url(uri), {
        responseType: "blob",
        timeout: 30000,
        headers: this._phoenix_auth_headers(),
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
      const item = await axios.put(this._phoenix_url(uri), data, {
        headers: this._phoenix_auth_headers(),
      });
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
      const item = await axios.patch(this._phoenix_url(uri), data, {
        headers: this._phoenix_auth_headers(),
      });
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
      const item = await axios.post(this._phoenix_url(uri), data, {
        headers: this._phoenix_auth_headers(),
      });
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
}

module.exports = PhoenixApiClient;
