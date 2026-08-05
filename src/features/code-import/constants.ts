// ---------------------------------------------------------------------------
// Universal Block Import — constants & limits (Phase P1)
//
// All limits are documented safe caps. They are enforced BEFORE or DURING
// normalization; violations are reported with limit + actual and never
// silently truncate structural input.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Structured error codes
// ---------------------------------------------------------------------------

export const CODE_IMPORT_EMPTY = "CODE_IMPORT_EMPTY";
export const CODE_IMPORT_TOO_LARGE = "CODE_IMPORT_TOO_LARGE";
export const CODE_LANGUAGE_UNKNOWN = "CODE_LANGUAGE_UNKNOWN";
export const CODE_PARSE_FAILED = "CODE_PARSE_FAILED";
export const CODE_AST_TOO_DEEP = "CODE_AST_TOO_DEEP";
export const CODE_TOO_MANY_NODES = "CODE_TOO_MANY_NODES";
export const CODE_TOO_MANY_ATTRIBUTES = "CODE_TOO_MANY_ATTRIBUTES";
export const CODE_TOO_MANY_CLASSES = "CODE_TOO_MANY_CLASSES";
export const CODE_TEXT_TOO_LARGE = "CODE_TEXT_TOO_LARGE";
export const CODE_CSS_TOO_LARGE = "CODE_CSS_TOO_LARGE";
export const CODE_SECURITY_REJECTED = "CODE_SECURITY_REJECTED";
export const CODE_DANGEROUS_KEY = "CODE_DANGEROUS_KEY";
export const CODE_UNSAFE_URL = "CODE_UNSAFE_URL";
export const CODE_DYNAMIC_EXPRESSION = "CODE_DYNAMIC_EXPRESSION";
export const CODE_UNSUPPORTED_SYNTAX = "CODE_UNSUPPORTED_SYNTAX";

// ---------------------------------------------------------------------------
// Source & structure limits
// ---------------------------------------------------------------------------

/** Max pasted source size in UTF-8 bytes (200 KB). */
export const MAX_SOURCE_SIZE_BYTES = 200 * 1024;

/** Max nodes in the normalized import AST. */
export const MAX_IMPORT_NODES = 2000;

/** Max structural depth of the normalized import AST. */
export const MAX_IMPORT_DEPTH = 40;

/** Max attributes per element. */
export const MAX_ATTRIBUTES_PER_ELEMENT = 100;

/** Max class tokens per element. */
export const MAX_CLASS_TOKENS_PER_ELEMENT = 500;

/** Max length of a single normalized text node. */
export const MAX_TEXT_NODE_LENGTH = 10000;

/** Documented safe cap on total normalized text content. */
export const MAX_TOTAL_TEXT_LENGTH = 100000;

/** Max CSS rules. */
export const MAX_CSS_RULES = 2000;

/** Max CSS declarations in total across all rules. */
export const MAX_CSS_DECLARATIONS = 10000;

/** Max CSS declarations within a single rule. */
export const MAX_CSS_DECLARATIONS_PER_RULE = 200;

/** Max parser errors returned to the UI (capped deterministically). */
export const MAX_PARSER_ERRORS_RETURNED = 20;

// ---------------------------------------------------------------------------
// Security finding codes
// ---------------------------------------------------------------------------

export const FINDING_SCRIPT_REMOVED = "script-removed";
export const FINDING_STYLE_REMOVED = "style-element-removed";
export const FINDING_IFRAME_REMOVED = "iframe-removed";
export const FINDING_OBJECT_EMBED_REMOVED = "object-embed-removed";
export const FINDING_EVENT_HANDLER_REMOVED = "event-handler-removed";
export const FINDING_UNSAFE_URL = "unsafe-url";
export const FINDING_DANGEROUS_HTML = "dangerously-set-inner-html";
export const FINDING_EXTERNAL_IMPORT_IGNORED = "external-import-ignored";
export const FINDING_DYNAMIC_IMPORT = "dynamic-import-ignored";
export const FINDING_REQUIRE = "require-ignored";
export const FINDING_NETWORK_CALL = "network-call-unsupported";
export const FINDING_HOOK_UNSUPPORTED = "hook-usage-unsupported";
export const FINDING_EVAL = "eval-detected";
export const FINDING_FUNCTION_CONSTRUCTOR = "function-constructor-detected";
export const FINDING_DOCUMENT_WRITE = "document-write-detected";
export const FINDING_WINDOW_LOCATION = "window-location-mutation";
export const FINDING_SPREAD_REMOVED = "spread-props-removed";
export const FINDING_DYNAMIC_EXPRESSION = "dynamic-expression-unsupported";
export const FINDING_UNRESOLVED_IDENTIFIER = "unresolved-identifier";
export const FINDING_CUSTOM_COMPONENT = "custom-component-unsupported";
export const FINDING_CUSTOM_COMPONENT_INLINED = "custom-component-inlined";
export const FINDING_CSS_IMPORT = "css-import-rejected";
export const FINDING_CSS_EXPRESSION = "css-expression-rejected";
export const FINDING_CSS_BEHAVIOR = "css-behavior-property-rejected";
export const FINDING_CSS_AT_RULE = "css-at-rule-ignored";
export const FINDING_CSS_MALFORMED = "css-malformed-declaration";
export const FINDING_RAW_SCRIPT = "raw-script-text";
export const FINDING_DANGEROUS_KEY = "dangerous-key";
export const FINDING_DATA_URL = "data-url-not-enabled";
export const FINDING_AMBIGUOUS_COMPONENTS = "ambiguous-component-selection";
