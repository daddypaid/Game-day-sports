-- Catalog-only comparison of public app objects. No application rows are read.
-- Definition hashes cover expressions/bodies without publishing literal values.
-- Fixed deparse search_path and C ordering make the snapshot deterministic.
with
settings as materialized (
  select pg_catalog.set_config('search_path', 'pg_catalog', true) as search_path
),
public_namespace as materialized (
  select n.* from pg_catalog.pg_namespace n cross join settings where n.nspname = 'public'
),
app_relations as materialized (
  select c.*, n.nspname from pg_catalog.pg_class c
  join public_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'f', 'v', 'm', 'S')
    and not exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass and d.objid = c.oid and d.deptype = 'e')
),
app_routines as materialized (
  select p.*, n.nspname from pg_catalog.pg_proc p
  join public_namespace n on n.oid = p.pronamespace
  where p.prokind in ('f', 'p')
    and not exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass and d.objid = p.oid and d.deptype = 'e')
),
app_types as materialized (
  select t.*, n.nspname from pg_catalog.pg_type t
  join public_namespace n on n.oid = t.typnamespace
  where t.typtype in ('e', 'd')
    and not exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_type'::pg_catalog.regclass and d.objid = t.oid and d.deptype = 'e')
),
relation_acl as (
  select c.oid, coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'grantor', pg_catalog.pg_get_userbyid(a.grantor),
    'grantee', case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
    'privilege', a.privilege_type, 'grantable', a.is_grantable
  ) order by pg_catalog.pg_get_userbyid(a.grantor) collate "C", case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end collate "C", a.privilege_type collate "C", a.is_grantable) filter (where a.privilege_type is not null), '[]'::pg_catalog.jsonb) as acl
  from app_relations c
  left join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault(case when c.relkind = 'S' then 'S'::"char" else 'r'::"char" end, c.relowner))) a on true
  group by c.oid
),
routine_acl as (
  select p.oid, coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'grantor', pg_catalog.pg_get_userbyid(a.grantor),
    'grantee', case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
    'privilege', a.privilege_type, 'grantable', a.is_grantable
  ) order by pg_catalog.pg_get_userbyid(a.grantor) collate "C", case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end collate "C", a.privilege_type collate "C", a.is_grantable) filter (where a.privilege_type is not null), '[]'::pg_catalog.jsonb) as acl
  from app_routines p
  left join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a on true
  group by p.oid
),
schema_acl as (
  select n.oid, coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'grantor', pg_catalog.pg_get_userbyid(a.grantor),
    'grantee', case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
    'privilege', a.privilege_type, 'grantable', a.is_grantable
  ) order by pg_catalog.pg_get_userbyid(a.grantor) collate "C", case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end collate "C", a.privilege_type collate "C", a.is_grantable) filter (where a.privilege_type is not null), '[]'::pg_catalog.jsonb) as acl
  from public_namespace n
  left join lateral pg_catalog.aclexplode(coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) a on true
  group by n.oid
),
default_acl as (
  select d.oid, pg_catalog.pg_get_userbyid(d.defaclrole) as owner,
    case when d.defaclnamespace = 0 then '*' else n.nspname end as namespace,
    d.defaclobjtype::pg_catalog.text as object_type,
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'grantor', pg_catalog.pg_get_userbyid(a.grantor),
      'grantee', case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
      'privilege', a.privilege_type, 'grantable', a.is_grantable
    ) order by pg_catalog.pg_get_userbyid(a.grantor) collate "C", case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end collate "C", a.privilege_type collate "C", a.is_grantable) filter (where a.privilege_type is not null), '[]'::pg_catalog.jsonb) as acl
  from pg_catalog.pg_default_acl d
  left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
  left join lateral pg_catalog.aclexplode(d.defaclacl) a on true
  where d.defaclnamespace = (select oid from public_namespace)
    or (d.defaclnamespace = 0 and d.defaclrole in (select relowner from app_relations union select proowner from app_routines union select typowner from app_types union select nspowner from public_namespace))
  group by d.oid, d.defaclrole, d.defaclnamespace, n.nspname, d.defaclobjtype
),
raw_entries as (
  select 'schema'::pg_catalog.text as kind, n.nspname::pg_catalog.text as key,
    pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(n.nspowner), 'acl', a.acl) as metadata
  from public_namespace n join schema_acl a on a.oid = n.oid

  union all
  select 'relation', c.nspname || '.' || c.relname, pg_catalog.jsonb_build_object(
    'relation_kind', c.relkind::pg_catalog.text, 'owner', pg_catalog.pg_get_userbyid(c.relowner),
    'persistence', c.relpersistence::pg_catalog.text, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
    'replica_identity', c.relreplident::pg_catalog.text,
    'options', coalesce((select pg_catalog.jsonb_agg(option order by option collate "C") from pg_catalog.unnest(c.reloptions) option), '[]'::pg_catalog.jsonb),
    'acl', a.acl,
    'view_definition_md5', case when c.relkind in ('v', 'm') then pg_catalog.md5(pg_catalog.pg_get_viewdef(c.oid, false)) else null end,
    'partition_key_md5', case when c.relkind = 'p' then pg_catalog.md5(pg_catalog.pg_get_partkeydef(c.oid)) else null end,
    'partition_bound_md5', case when c.relispartition then pg_catalog.md5(pg_catalog.pg_get_expr(c.relpartbound, c.oid, false)) else null end,
    'parents', coalesce((select pg_catalog.jsonb_agg(pn.nspname || '.' || pc.relname order by pn.nspname collate "C", pc.relname collate "C") from pg_catalog.pg_inherits i join pg_catalog.pg_class pc on pc.oid = i.inhparent join pg_catalog.pg_namespace pn on pn.oid = pc.relnamespace where i.inhrelid = c.oid), '[]'::pg_catalog.jsonb)
  )
  from app_relations c join relation_acl a on a.oid = c.oid

  union all
  select 'column', c.nspname || '.' || c.relname || '.' || a.attname, pg_catalog.jsonb_build_object(
    'type', pg_catalog.format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull,
    'identity', a.attidentity::pg_catalog.text, 'generated', a.attgenerated::pg_catalog.text,
    'default_md5', pg_catalog.md5(pg_catalog.pg_get_expr(d.adbin, d.adrelid, false)),
    'collation', case when a.attcollation = 0 then null else cn.nspname || '.' || co.collname end,
    'storage', a.attstorage::pg_catalog.text,
    'acl', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'grantor', pg_catalog.pg_get_userbyid(g.grantor), 'grantee', case when g.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(g.grantee) end,
      'privilege', g.privilege_type, 'grantable', g.is_grantable
    ) order by pg_catalog.pg_get_userbyid(g.grantor) collate "C", case when g.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(g.grantee) end collate "C", g.privilege_type collate "C", g.is_grantable) from pg_catalog.aclexplode(a.attacl) g), '[]'::pg_catalog.jsonb)
  )
  from app_relations c join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_catalog.pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  left join pg_catalog.pg_collation co on co.oid = a.attcollation
  left join pg_catalog.pg_namespace cn on cn.oid = co.collnamespace
  where c.relkind <> 'S'

  union all
  select 'constraint', coalesce(r.nspname || '.' || r.relname, t.nspname || '.' || t.typname) || '.' || c.conname,
    pg_catalog.jsonb_build_object('type', c.contype::pg_catalog.text, 'deferrable', c.condeferrable, 'initially_deferred', c.condeferred,
      'validated', c.convalidated, 'no_inherit', c.connoinherit, 'definition_md5', pg_catalog.md5(pg_catalog.pg_get_constraintdef(c.oid, false)),
      'referenced_relation', case when c.confrelid = 0 then null else rn.nspname || '.' || rc.relname end,
      'parent_constraint', case when c.conparentid = 0 then null else pc.conname end)
  from pg_catalog.pg_constraint c
  left join app_relations r on r.oid = c.conrelid
  left join app_types t on t.oid = c.contypid
  left join pg_catalog.pg_class rc on rc.oid = c.confrelid left join pg_catalog.pg_namespace rn on rn.oid = rc.relnamespace
  left join pg_catalog.pg_constraint pc on pc.oid = c.conparentid
  where (r.oid is not null or t.oid is not null)
    and not exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_constraint'::pg_catalog.regclass and d.objid = c.oid and d.deptype = 'e')

  union all
  select 'index', c.nspname || '.' || ix.relname, pg_catalog.jsonb_build_object(
    'relation', c.nspname || '.' || c.relname, 'method', am.amname, 'unique', i.indisunique, 'primary', i.indisprimary,
    'exclusion', i.indisexclusion, 'immediate', i.indimmediate, 'valid', i.indisvalid, 'ready', i.indisready,
    'replica_identity', i.indisreplident, 'clustered', i.indisclustered,
    'definition_md5', pg_catalog.md5(pg_catalog.pg_get_indexdef(i.indexrelid, 0, false)),
    'predicate_md5', pg_catalog.md5(pg_catalog.pg_get_expr(i.indpred, i.indrelid, false)),
    'expression_md5', pg_catalog.md5(pg_catalog.pg_get_expr(i.indexprs, i.indrelid, false)),
    'options', coalesce((select pg_catalog.jsonb_agg(option order by option collate "C") from pg_catalog.unnest(ix.reloptions) option), '[]'::pg_catalog.jsonb)
  )
  from app_relations c join pg_catalog.pg_index i on i.indrelid = c.oid join pg_catalog.pg_class ix on ix.oid = i.indexrelid
  join pg_catalog.pg_am am on am.oid = ix.relam
  where not exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass and d.objid = ix.oid and d.deptype = 'e')

  union all
  select 'policy', c.nspname || '.' || c.relname || '.' || p.polname, pg_catalog.jsonb_build_object(
    'command', p.polcmd::pg_catalog.text, 'permissive', p.polpermissive,
    'roles', (select pg_catalog.jsonb_agg(case when role_id = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(role_id) end order by case when role_id = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(role_id) end collate "C") from pg_catalog.unnest(p.polroles) role_id),
    'using_md5', pg_catalog.md5(pg_catalog.pg_get_expr(p.polqual, p.polrelid, false)),
    'check_md5', pg_catalog.md5(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, false))
  ) from app_relations c join pg_catalog.pg_policy p on p.polrelid = c.oid

  union all
  select 'trigger', c.nspname || '.' || c.relname || '.' || t.tgname, pg_catalog.jsonb_build_object(
    'function', pn.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
    'enabled', t.tgenabled::pg_catalog.text, 'type', t.tgtype, 'deferrable', t.tgdeferrable, 'initially_deferred', t.tginitdeferred,
    'definition_md5', pg_catalog.md5(pg_catalog.pg_get_triggerdef(t.oid, false)),
    'arguments_md5', pg_catalog.md5(pg_catalog.encode(t.tgargs, 'hex')),
    'when_present', t.tgqual is not null
  ) from app_relations c join pg_catalog.pg_trigger t on t.tgrelid = c.oid
  join pg_catalog.pg_proc p on p.oid = t.tgfoid join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
  where not t.tgisinternal
    and not exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_trigger'::pg_catalog.regclass and d.objid = t.oid and d.deptype = 'e')

  union all
  select 'routine', p.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
    pg_catalog.jsonb_build_object(
      'kind', p.prokind::pg_catalog.text, 'owner', pg_catalog.pg_get_userbyid(p.proowner), 'language', l.lanname,
      'returns', pg_catalog.pg_get_function_result(p.oid), 'returns_set', p.proretset,
      'security_definer', p.prosecdef, 'strict', p.proisstrict, 'leakproof', p.proleakproof,
      'volatility', p.provolatile::pg_catalog.text, 'parallel', p.proparallel::pg_catalog.text,
      'cost', p.procost, 'rows', p.prorows,
      'body_md5', pg_catalog.md5(p.prosrc), 'binary_md5', pg_catalog.md5(p.probin),
      'definition_md5', pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)),
      'arguments_md5', pg_catalog.md5(pg_catalog.pg_get_function_arguments(p.oid)),
      'configuration', coalesce((select pg_catalog.jsonb_agg(setting order by setting collate "C") from pg_catalog.unnest(p.proconfig) setting where setting like 'search_path=%'), '[]'::pg_catalog.jsonb),
      'other_configuration_md5', pg_catalog.md5(coalesce((select pg_catalog.string_agg(setting, E'\n' order by setting collate "C") from pg_catalog.unnest(p.proconfig) setting where setting not like 'search_path=%'), '')),
      'acl', a.acl
    )
  from app_routines p join pg_catalog.pg_language l on l.oid = p.prolang join routine_acl a on a.oid = p.oid

  union all
  select 'sequence', c.nspname || '.' || c.relname, pg_catalog.jsonb_build_object(
    'type', pg_catalog.format_type(s.seqtypid, -1), 'start', s.seqstart::pg_catalog.text, 'increment', s.seqincrement::pg_catalog.text,
    'minimum', s.seqmin::pg_catalog.text, 'maximum', s.seqmax::pg_catalog.text, 'cache', s.seqcache::pg_catalog.text, 'cycle', s.seqcycle,
    'owned_by', coalesce((select pg_catalog.jsonb_agg(n.nspname || '.' || r.relname || '.' || a.attname order by n.nspname collate "C", r.relname collate "C", a.attname collate "C")
      from pg_catalog.pg_depend d join pg_catalog.pg_class r on r.oid = d.refobjid join pg_catalog.pg_namespace n on n.oid = r.relnamespace join pg_catalog.pg_attribute a on a.attrelid = r.oid and a.attnum = d.refobjsubid
      where d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass and d.objid = c.oid and d.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass and d.deptype in ('a', 'i')), '[]'::pg_catalog.jsonb)
  ) from app_relations c join pg_catalog.pg_sequence s on s.seqrelid = c.oid

  union all
  select 'default_acl', d.owner || '.' || d.namespace || '.' || d.object_type,
    pg_catalog.jsonb_build_object('owner', d.owner, 'schema', d.namespace, 'object_type', d.object_type, 'acl', d.acl)
  from default_acl d

  union all
  select 'type', t.nspname || '.' || t.typname, pg_catalog.jsonb_build_object(
    'kind', t.typtype::pg_catalog.text, 'owner', pg_catalog.pg_get_userbyid(t.typowner),
    'base_type', case when t.typtype = 'd' then pg_catalog.format_type(t.typbasetype, t.typtypmod) else null end,
    'not_null', t.typnotnull, 'default_md5', pg_catalog.md5(pg_catalog.pg_get_expr(t.typdefaultbin, 0, false)),
    'enum_labels', coalesce((select pg_catalog.jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_catalog.pg_enum e where e.enumtypid = t.oid), '[]'::pg_catalog.jsonb)
  ) from app_types t
),
entries as materialized (
  select kind, key, metadata, pg_catalog.md5(metadata::pg_catalog.text) as metadata_md5 from raw_entries
),
snapshot as (
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('kind', kind, 'key', key, 'metadata', metadata, 'metadata_md5', metadata_md5) order by kind collate "C", key collate "C"), '[]'::pg_catalog.jsonb) as entries from entries
)
select pg_catalog.jsonb_build_object(
  'schema_version', 1,
  'scope', 'public_non_extension_catalog',
  'definition_hash_algorithm', 'md5',
  'ordering', 'kind,key COLLATE C',
  'counts', (select pg_catalog.jsonb_object_agg(kind, count order by kind collate "C") from (select kind, count(*) as count from entries group by kind) grouped),
  'entries', snapshot.entries,
  'schema_md5', pg_catalog.md5(snapshot.entries::pg_catalog.text)
) as fingerprint from snapshot;
