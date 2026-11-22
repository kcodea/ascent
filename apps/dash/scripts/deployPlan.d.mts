export declare const PROJECT_NAME: string;
export declare const DIST_DIR: string;
export declare const APP_DIR: string;
export declare const PRODUCTION_REFUSAL: string;
export declare function deployPlan(argv: string[]): { branch: 'preview' | 'main'; args: string[] } | { error: string };
