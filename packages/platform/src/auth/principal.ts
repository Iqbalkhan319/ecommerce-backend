export type PrincipalType = 'ADMIN' | 'CUSTOMER';

export interface AccessTokenClaims {
  sub: string;
  typ: PrincipalType;
  roles: string[];
  sid: string;
  jti: string;
  iss: string;
  aud: string | string[];
  iat: number;
  exp: number;
}

export interface Principal {
  id: string;
  type: PrincipalType;
  roles: string[];
  sessionId: string;
  tokenId: string;
  expiresAt: Date;
}

export interface AuthenticatedRequest {
  principal?: Principal;
}
