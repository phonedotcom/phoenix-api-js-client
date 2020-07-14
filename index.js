const USER_STORAGE_KEY = "mini-user";
const axios = require("axios");

/** Class representing a PhoenixApi client. */
class PhoenixApiClient {
  user = null;
  extension_id = null;
  options = {
    client_id: null,
    handle_rate_limit: true,
    handle_server_error: 3,
    session_name: "phoenix-api-js-client-session",
  };
  /**
   * Create a PhoenixApiClient.
   * @param {object} options - objects that updates class options
   */
  constructor(options = {}) {
    Object.assign(this.options, options);
    let user = sessionStorage.getItem(this.options.session_name);
    if (user) user = JSON.parse(user);

    user && this.set_user(user);
  }

  /**
    * Generates common 429 error message.
    * @param {number} seconds - The number of seconds user has to wait for the new request.
    * @return {string} formated message.
  */
  throttleMessage(seconds) {
    return `Too much requests. It will retry after ${seconds}s`;
  }

  /**
    * Handles rate limit if enabled in the constructor options.
    * @param {object} err - The error object returned from he API
    * @param {function} callback - the method that will be executed right after rate limit ends
    * @return {Promise} result of resent request
  */
  handle_rate_limit(err, callback) {
    const seconds = err.data["@error"]["@rateLimit"]["Retry-After"] || 1;
    console.log(this.throttleMessage(seconds));
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
    console.log(err);
    console.log("Internal server error. Retrying...");
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
  */
  async load_user(token, attempt = 1) {
    try {
      const headers = this.phoenix_auth_headers(token);
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
    } catch (err) {
      err = err.response;
      if (err.status === 429 && this.options.handle_rate_limit) {
        await this.handle_rate_limit(err, async () => {
          await this.load_user(token, attempt);
        });
      }

      if (
        err.status >= 500 &&
        err.status <= 599 &&
        this.options.handle_server_error &&
        attempt <= this.options.handle_server_error
      ) {
        await this.handle_internal_server_error(err, async () => {
          attempt++;
          return await this.load_user(token, attempt);
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
    this.extension_id = null;
    this.options = {
      client_id: null,
      handle_rate_limit: true,
      handle_server_error: 3,
      session_name: "phoenix-api-js-client-session",
    };
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
    this.set_extension(
      user.hasOwnProperty("extension") ? user["extension"] : null
    );
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
    * Sets extension id
    * @param {number} extension_id - Extension Id that will be used for calls
  */
  set_extension(extension_id) {
    this.extension_id = extension_id;
  }

  /**
    * Generates sign in page link for the user
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
    const state = Math.floor(Math.random() * 10000000);
    const redirect = `${document.location.protocol}//${document.location.host}${redirect_path}`;
    return `https://oauth.phone.com/?client_id=${
      this.options.client_id
    }&response_type=${
      is_token ? "token" : "code"
    }&scope=account-owner&redirect_uri=${encodeURIComponent(
      redirect
    )}&state=${state}`;
  }

  /**
    * Generates base url for the api calls
    * @param {string} uri - path to specific resource
    * @param {boolean} global - if false - looks on the user account level, 
    * true - looks generaly 
    * @return {string} generated url
  */
  _phoenix_url(uri, global) {
    let url = "https://api.cit-phone.com/v4";
    if (!global) {
      url += `/accounts/${this.user["id"]}`;
    }
    return `${url}${uri}`;
  }

  /**
    * Generates headers for API calls.
    * @param {string} token - nullable, session user token or Bearer token
    * @return {object} headers object
  */
  phoenix_auth_headers(token) {
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
    * @return {object} object containing all items
  */
  async get_list_all(uri) {
    let all = [];
    let res;
    do {
      res = await this.get_list(
        uri,
        500,
        res ? res["offset"] + res["limit"] : 0
      );
      all = all.concat(res["items"]);
    } while (res["total"] < all.length);
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
    * @param {boolean} global - if false - looks on the user account level, 
    * true - looks generaly 
    * @return {object} object containing items
  */
  async get_list(uri, limit, offset, global, attempt = 1) {
    try {
      if (limit) {
        uri += uri.includes("?") ? "&" : "?";
        uri += "limit=" + limit;
        if (offset) uri += "&offset=" + offset;
      }
      const r = await axios.get(this._phoenix_url(uri, global), {
        headers: this.phoenix_auth_headers(),
      });
      return {
        items: r.data["items"],
        offset: r.data["offset"],
        total: r.data["total"],
        limit: r.data["limit"],
      };
    } catch (err) {
      err = err;
      if (err.status === 429 && this.options.handle_rate_limit) {
        return await this.handle_rate_limit(err, async () => {
          return await this.get_list(uri, limit, offset, global, attempt);
        });
      }
      if (
        err.status >= 500 &&
        err.status <= 599 &&
        this.options.handle_server_error &&
        attempt <= this.options.handle_server_error
      ) {
        await this.handle_internal_server_error(err, async () => {
          attempt++;
          return await this.get_list(uri, limit, offset, global, attempt);
        });
      }
      throw err;
    }
  }

  /**
    * Gets the item specified in the uri
    * @param {string} uri - target resource uri
    * @return {object} response object.
  */
  async get_item(uri, attempt = 1) {
    try {
      const item = await axios.get(this._phoenix_url(uri), {
        headers: this.phoenix_auth_headers(),
      });
      return item.data;
    } catch (err) {
      err = err.response;
      if (err.status === 429 && this.options.handle_rate_limit) {
        return await this.handle_rate_limit(err, async () => {
          return await this.get_item(uri, attempt);
        });
      }
      if (
        err.status >= 500 &&
        err.status <= 599 &&
        this.options.handle_server_error &&
        attempt <= this.options.handle_server_error
      ) {
        await this.handle_internal_server_error(err, async () => {
          attempt++;
          return await this.get_item(uri, attempt);
        });
      }
      throw err;
    }
  }

  /**
    * Deletes the item specified in the uri
    * @param {string} uri - target resource uri
    * @return {object} response object.
  */
  async delete_item(uri, attempt = 1) {
    try {
      const item = await axios.delete(this._phoenix_url(uri), {
        headers: this.phoenix_auth_headers(),
      });
      return item.data;
    } catch (err) {
      err = err.response;
      if (err.status === 429 && this.options.handle_rate_limit) {
        return await this.handle_rate_limit(err, async () => {
          return await this.delete_item(uri, attempt);
        });
      }
      if (
        err.status >= 500 &&
        err.status <= 599 &&
        this.options.handle_server_error &&
        attempt <= this.options.handle_server_error
      ) {
        await this.handle_internal_server_error(err, async () => {
          attempt++;
          return await this.delete_item(uri, attempt);
        });
      }
      throw err;
    }
  }

  /**
    * Downloads the item specified in the uri
    * @param {string} uri - target resource uri
    * @return {object} response object.
  */
  async download_item(uri, attempt = 1) {
    try {
      const item = await axios.get(this._phoenix_url(uri), {
        responseType: "blob",
        timeout: 30000,
        headers: this.phoenix_auth_headers(),
      });
      return item.data;
    } catch (err) {
      err = err.response;
      if (err.status === 429 && this.options.handle_rate_limit) {
        return await this.handle_rate_limit(err, async () => {
          return await this.download_item(uri, attempt);
        });
      }
      if (
        err.status >= 500 &&
        err.status <= 599 &&
        this.options.handle_server_error &&
        attempt <= this.options.handle_server_error
      ) {
        await this.handle_internal_server_error(err, async () => {
          attempt++;
          return await this.download_item(uri, attempt);
        });
      }
      throw err;
    }
  }

  /**
    * Sends PUT request to update the item specified in the uri
    * @param {string} uri - target resource uri
    * @param {object} data - data that should be updated
    * @return {object} response object.
  */
  async replace_item(uri, data, attempt = 1) {
    try {
      const item = await axios.put(this._phoenix_url(uri), data, {
        headers: this.phoenix_auth_headers(),
      });
      return item.data;
    } catch (err) {
      err = err.response;
      if (err.status === 429 && this.options.handle_rate_limit) {
        return await this.handle_rate_limit(err, async () => {
          return await this.replace_item(uri, data, attempt);
        });
      }
      if (
        err.status >= 500 &&
        err.status <= 599 &&
        this.options.handle_server_error &&
        attempt <= this.options.handle_server_error
      ) {
        await this.handle_internal_server_error(err, async () => {
          attempt++;
          return await this.replace_item(uri, data, attempt);
        });
      }
      throw err;
    }
  }

  /**
    * Sends PATCH request to update the item specified in the uri
    * @param {string} uri - target resource uri
    * @param {object} data - data that should be updated
    * @return {object} response object.
  */
  async patch_item(uri, data, attempt = 1) {
    try {
      const item = await axios.patch(this._phoenix_url(uri), data, {
        headers: this.phoenix_auth_headers(),
      });
      return item.data;
    } catch (err) {
      err = err.response;
      if (err.status === 429 && this.options.handle_rate_limit) {
        return await this.handle_rate_limit(err, async () => {
          return await this.patch_item(uri, data, attempt);
        });
      }
      if (
        err.status >= 500 &&
        err.status <= 599 &&
        this.options.handle_server_error &&
        attempt <= this.options.handle_server_error
      ) {
        await this.handle_internal_server_error(err, async () => {
          attempt++;
          return await this.patch_item(uri, data, attempt);
        });
      }
      throw err;
    }
  }

  /**
    * Created the resource specified in the uri
    * @param {string} uri - target resource uri
    * @param {object} data - data that should be created
    * @return {object} response object.
  */
  async create_item(uri, data, attempt = 1) {
    try {
      const item = await axios.post(this._phoenix_url(uri), data, {
        headers: this.phoenix_auth_headers(),
      });
      return item.data;
    } catch (err) {
      err = err.response;
      if (err.status === 429 && this.options.handle_rate_limit) {
        return await this.handle_rate_limit(err, async () => {
          return await this.create_item(uri, data, attempt);
        });
      }
      if (
        err.status >= 500 &&
        err.status <= 599 &&
        this.options.handle_server_error &&
        attempt <= this.options.handle_server_error
      ) {
        await this.handle_internal_server_error(err, async () => {
          attempt++;
          return await this.create_item(uri, data, attempt);
        });
      }
      throw err;
    }
  }
}

module.exports = PhoenixApiClient;