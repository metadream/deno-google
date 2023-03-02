import { decode as base64UrlDecode } from "https://deno.land/std@0.177.0/encoding/base64url.ts";
import { verify } from "https://deno.land/x/djwt@v2.8/mod.ts";

const OAUTH_URL = 'https://accounts.google.com/o/oauth2';
const TOKEN_URL = 'https://www.googleapis.com/oauth2/v4/token';
const CERTS_URL = 'https://www.googleapis.com/oauth2/v1/certs';

const textDecode = (u: Uint8Array) => new TextDecoder().decode(u);

type Options = {
    client_id: string,
    client_secret: string,
    redirect_uri: string,
    scopes: string[],
}

/**
 * Google OAuth2 authorization,
 * its purpose is to get refresh_token
 */
export class GoogleOAuth {

    #options: Options;

    /**
     * Construction and initialization
     * @param options
     */
    constructor(options: Options) {
        this.#options = options;
    }

    /**
     * Step 1. Build the authorization link
     * After clicking the link to complete the authorization,
     * it will redirect to the uri with the "code" parameter.
     *
     * @returns string
     */
    buildAuthLink(): string {
        return OAUTH_URL + "/auth?" + this.#stringify({
            client_id: this.#options.client_id,
            redirect_uri: this.#options.redirect_uri,
            scope: this.#options.scopes.join(' '),
            response_type: 'code',
            access_type: 'offline', // 'online' (default) or 'offline' (gets refresh_token)
        });
    }

    /**
     * Step 2. Get tokens according to the "code" returned in the first step.
     * id_token is a JWT, You can set cookie with it as login credential.
     *
     * @param code
     * @returns object { refresh_token, access_token, id_token... }
     */
    async getTokens(code: string) {
        const response = await fetch(OAUTH_URL + '/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: this.#stringify({
                code: code,
                client_id: this.#options.client_id,
                client_secret: this.#options.client_secret,
                redirect_uri: this.#options.redirect_uri,
                grant_type: 'authorization_code'
            })
        });
        const result = await response.json();
        if (result.error) {
            throw { status: response.status, message: result.error_description };
        }
        return result;
    }

    /**
     * Step 3. Get access_token (expired in 1 hour) according to the refresh_token
     *  (permanently valid) in the previous step.
     *
     * @param refresh_token
     * @returns object { access_token, expires_in }
     */
    async getAccessToken(refresh_token: string) {
        const response = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: this.#stringify({
                client_id: this.#options.client_id,
                client_secret: this.#options.client_secret,
                refresh_token: refresh_token,
                grant_type: 'refresh_token'
            })
        });
        const result = await response.json();
        if (result.error) {
            throw { status: response.status, message: result.error_description };
        }
        return result;
    }

    /**
     * Decode id_token (without verifiy signature)
     * id_token contains some private information of google account, but
     * it's not necessary to verify the signature when we are authorizing
     *
     * @param token id_token/JWT
     * @returns object { header, payload, signature }
     */
    decodeIdToken(token: string) {
        if (!token) {
            throw { status: 400, message: "Undefined token" };
        }
        const segments = token.split('.');
        if (segments.length !== 3) {
            throw { status: 400, message: "Not enough or too many segment" };
        }
        return {
            header: JSON.parse(textDecode(base64UrlDecode(segments[0]))),
            payload: JSON.parse(textDecode(base64UrlDecode(segments[1]))), // email, sub...
            signature: segments[2]
        }
    }

    /**
     * Decode id_token and verify signature via CERTS_URL.
     * The content in CERTS_URL will be updated from time to time.
     * For unofficial tokens, it's recommended to verify the signature
     *
     * @param token id_token/JWT
     * @returns
     */
    async verifyIdToken(token: string) {
        try {
            const decoded = this.decodeIdToken(token);
            const kid = decoded.header.kid;
            const response = await fetch(CERTS_URL);
            const cert = await response.json();
            return await verify(token, cert[kid]);
        } catch (e) {
            console.log(e);
        }
    }

    /**
     * Convert object to querystring
     * @param p
     * @returns
     */
    #stringify(p: Record<string, string | number | boolean>) {
        const qs: string[] = [];
        for (const k in p) {
            if (p[k]) qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(p[k]));
        }
        return qs.join("&");
    }

}