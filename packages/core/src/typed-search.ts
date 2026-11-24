// Only the config's type crosses into the browser.
import type { SearchClient } from "./runtime.js";
import type { QueryOptions, QueryResponse, SearchResult, WhereClause } from "./types.js";

type ConfigShape = { corpora: Record<string, unknown> };
type CorpusName<C extends ConfigShape> = keyof C["corpora"] & string;
type Fields<Corpus, Key extends string> =
  Corpus extends Record<Key, readonly (infer K extends string)[]> ? K : never;
type SourceRows<S> = S extends { load: infer Loader }
  ? SourceRows<Loader>
  : S extends (...args: never[]) => infer Rows
    ? Awaited<Rows>
    : S;
// Indexed fields missing from a source row are stored as null in format v2.
type Metadata<Row, Indexed> = Row extends { metadata?: infer M extends Record<string, unknown> }
  ? {
      [K in keyof M]?:
        | M[K]
        | (K extends Indexed ? (undefined extends Row["metadata"] | M[K] ? null : never) : never);
    }
  : Record<string, unknown>;
type ResultMetadata<C> = C extends { source: infer S }
  ? SourceRows<S> extends readonly (infer Row)[]
    ? Metadata<Row, Fields<C, "filters"> | Fields<C, "facets">>
    : Record<string, unknown>
  : Record<string, unknown>;

type CorpusHit<C extends ConfigShape, N extends CorpusName<C>> =
  N extends CorpusName<C>
    ? Omit<SearchResult, "corpus" | "metadata" | "document"> & {
        corpus: N;
        metadata?: ResultMetadata<C["corpora"][N]>;
        document: Omit<SearchResult["document"], "chunks"> & { chunks?: CorpusHit<C, N>[] };
      }
    : never;

type Where<Keys extends string> = [Keys] extends [never]
  ? Record<string, never>
  : Partial<Record<Keys, WhereClause[string]>>;

type QueryFields<C extends ConfigShape, N extends CorpusName<C>> = Omit<
  QueryOptions,
  "corpora" | "facets" | "where"
> & {
  facets?: readonly Fields<C["corpora"][N], "facets">[];
  where?: Where<Fields<C["corpora"][N], "filters"> | Fields<C["corpora"][N], "facets">>;
};

type ResponseFor<C extends ConfigShape, N extends CorpusName<C>> = Omit<
  QueryResponse,
  "results"
> & { results: CorpusHit<C, N>[] };

export interface TypedSearchClient<C extends ConfigShape> extends Pick<SearchClient, "warmup"> {
  load(corpus: CorpusName<C>): Promise<void>;
  loaded(): CorpusName<C>[];
  query<N extends CorpusName<C>>(
    query: string,
    options: { corpora: readonly N[] } & QueryFields<C, NoInfer<N>>,
  ): Promise<ResponseFor<C, N>>;
  query(
    query: string,
    options?: { corpora?: undefined } & QueryFields<C, CorpusName<C>>,
  ): Promise<ResponseFor<C, CorpusName<C>>>;
}
