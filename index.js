const USER_STORAGE_KEY = 'mini-user';

class PhoenixApiClient {

  user = null;
  extension_id = null;
  options = {
    'session_name': 'phoenix-api-js-client-session'
  };

  constructor(options = {}) {
    Object.assign(this.options, options);
    const user = sessionStorage.getItem(this.options.session_name);
    if (user) {
      user = JSON.parse(user)
    }
    user && this.set_user(user);
  }

  throttleMessage(seconds) {
    return `Too much requests. It will retry after ${seconds}s`
  }

  handle_rate_limit(err, callback) {
    const seconds = err.response['@error']['@rateLimit']['Retry-After'] || 1;
    console.log(this.throttleMessage(seconds));
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        callback().then(resolve).catch(reject);
      }, seconds * 1000)
    })
  }

  handle_internal_server_error(err, callback) {
    console.log('Internal server error. Retrying...');
    return new Promise((resolve, reject) => { // TODO Add 500ms timeout
      callback().then(resolve).catch(reject);
    })
  }

  async load_user(token, attempt = 1) {
    try {
      const headers = this.phoenix_auth_headers(token);
      const response = await ajax('GET', this._phoenix_url('/oauth/access-token', true), null, headers);
      history.pushState('', document.title, `${window.location.pathname}${window.location.search}`);
      this.set_user({
        'id': response.response['scope_details'][0]['voip_id'],
        'token': token,
        'expiration': response.response['expires_at'] ? response.response['expires_at'] * 1000 : null,
      });
    } catch (err) {
      if (err.status === 429) {
        await this.handle_rate_limit(err, async () => {
          await this.load_user(token, attempt)
        })
      }

      if (err.status >= 500 && err.status <=599 && attempt <= 3) {
        await this.handle_internal_server_error(err, async () => {
          attempt++;
          return await this.load_user(token, attempt)
        })
      }

      throw err;
    }
  }

  sign_out() {
    sessionStorage.removeItem(this.session_name);
    this.user = null;
    this.extension_id = null;
  }

  handle_expired_session() {
    alert('You session has expired. Please sign in again.');
    this.sign_out();
  }

  set_user(user) {
    this.user = user;
    this.set_extension(user.hasOwnProperty('extension') ? user['extension'] : null);
    if (user['expiration']) {
      const timeout = user['expiration'] - Date.now() - 10000;
      if (timeout < 0) {
        this.handle_expired_session();
      } else {
        sessionStorage.setItem(this.session_name, JSON.stringify(user, null, 2));
        setTimeout(this.handle_expired_session.bind(this), timeout)
      }
    }
  }

  set_extension(extension_id) {
    this.extension_id = extension_id
  }

  get_auth_link() {
    return this._get_auth_link('', true)
  }

  _get_auth_link(redirect_path, is_token) {
    const client_id = 'cc36cf14-3171-4277-8528-4ab1323ee402';
    const state = Math.floor(Math.random() * 10000000);
    const redirect = `${document.location.protocol}//${document.location.host}${redirect_path}`;
    return `https://oauth.phone.com/?client_id=${client_id}&response_type=${is_token ? 'token' : 'code'}&scope=account-owner&redirect_uri=${encodeURIComponent(redirect)}&state=${state}`
  }

  _phoenix_url(uri, global) {
    let url = 'https://api.cit-phone.com/v4';
    if (!global) {
      url += `/accounts/${this.user['id']}`;
    }
    return `${url}${uri}`
  }

  phoenix_auth_headers(token) {
    return (this.user && this.user['token'] || token) ? [
      {
        'name': 'Authorization',
        'value': token ? token : this.user['token']
      },
      {
        "name": "Prefer",
        "value": "representation=minimal"
      }
    ] : []
  }

  async get_list_all(uri) {
    let all = [];
    let res;
    do {
      res = await this.get_list(uri, 500, res ? res['offset'] + res['limit'] : 0);
      all = all.concat(res['items'])
    } while (res['total'] < all.length);
    return {
      'items': all,
      'offset': 0,
      'total': all.length,
      'limit': all.length,
    }
  }

  async get_list(uri, limit, offset, global, attempt=1) {
    try {
      if (limit) {
        uri += uri.includes('?') ? '&' : '?';
        uri += 'limit=' + limit;
        if (offset) uri += '&offset=' + offset;
      }
      const r = await ajax('GET', this._phoenix_url(uri, global), null, this.phoenix_auth_headers());
      return {
        'items': r.response['items'],
        'offset': r.response['offset'],
        'total': r.response['total'],
        'limit': r.response['limit'],
      };
    } catch (err) {
      if (err.status === 429) {
        return await this.handle_rate_limit(err, async () => {
          return await this.get_list(uri, limit, offset, global, attempt);
        })
      }
      if (err.status >= 500 && err.status <=599 && attempt <= 3) {
        await this.handle_internal_server_error(err, async () => {
          attempt++;
          return await this.get_list(uri, limit, offset, global, attempt);
        })
      }
      throw err;
    }
  }

  async get_item(uri, attempt=1) {
    try {
      const item = await ajax('GET', this._phoenix_url(uri), null, this.phoenix_auth_headers());
      return item.response;
    } catch (err) {
      if (err.status === 429) {
        return await this.handle_rate_limit(err, async () => {
          return await this.get_item(uri, attempt);
        });
      }
      if (err.status >= 500 && err.status <=599 && attempt <= 3) {
        await this.handle_internal_server_error(err, async () => {
          attempt++;
          return await this.get_item(uri, attempt);
        })
      }
      throw err;
    }
  }

  async delete_item(uri, attempt=1) {
    try {
      const item = await ajax('DELETE', this._phoenix_url(uri), null, this.phoenix_auth_headers());
      return item.response;
    } catch (err) {
      if (err.status === 429) {
        return await this.handle_rate_limit(err, async () => {
          return await this.delete_item(uri, attempt);
        });
      }
      if (err.status >= 500 && err.status <=599 && attempt <= 3) {
        await this.handle_internal_server_error(err, async () => {
          attempt++;
          return await this.delete_item(uri, attempt);
        })
      }
      throw err;
    }
  }

  async download_item(uri, attempt=1) {
    try {
      const item = await ajax('GET', this._phoenix_url(uri), null, this.phoenix_auth_headers(), null, true);
      return item.response;
    } catch (err) {
      if (err.status === 429) {
        return await this.handle_rate_limit(err, async () => {
          return await this.download_item(uri, attempt);
        });
      }
      if (err.status >= 500 && err.status <=599 && attempt <= 3) {
        await this.handle_internal_server_error(err, async () => {
          attempt++;
          return await this.download_item(uri, attempt);
        })
      }
      throw err;
    }
  }

  async replace_item(uri, data, attempt=1) {
    try {
      const item = await ajax('PUT', this._phoenix_url(uri), data, this.phoenix_auth_headers());
      return item.response;
    } catch (err) {
      if (err.status === 429) {
        return await this.handle_rate_limit(err, async () => {
          return await this.replace_item(uri, data, attempt);
        });
      }
      if (err.status >= 500 && err.status <=599 && attempt <= 3) {
        await this.handle_internal_server_error(err, async () => {
          attempt++;
          return await this.replace_item(uri, data, attempt);
        })
      }
      throw err;
    }
  }

  async patch_item(uri, data, attempt=1) {
    try {
      const item = await ajax('PATCH', this._phoenix_url(uri), data, this.phoenix_auth_headers());
      return item.response;
    } catch (err) {
      if (err.status === 429) {
        return await this.handle_rate_limit(err, async () => {
          return await this.patch_item(uri, data, attempt);
        });
      }
      if (err.status >= 500 && err.status <=599 && attempt <= 3) {
        await this.handle_internal_server_error(err, async () => {
          attempt++;
          return await this.patch_item(uri, data, attempt);
        })
      }
      throw err;
    }
  }

  async create_item(uri, data, attempt=1) {
    try {
      const item = await ajax('POST', this._phoenix_url(uri), data, this.phoenix_auth_headers());
      return item.response;
    } catch (err) {
      if (err.status === 429) {
        return await this.handle_rate_limit(err, async () => {
          return await this.create_item(uri, data, attempt);
        });
      }
      if (err.status >= 500 && err.status <=599 && attempt <= 3) {
        await this.handle_internal_server_error(err, async () => {
          attempt++;
          return await this.create_item(uri, data, attempt);
        })
      }
      throw err;
    }
  }
}

module.exports = PhoenixApiClient;