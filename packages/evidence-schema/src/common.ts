import Type from 'typebox';

export const Draft202012 = 'https://json-schema.org/draft/2020-12/schema' as const;

export const NonEmptyString = Type.String({ minLength: 1 });

export const Sha256Digest = Type.String({ pattern: '^[a-f0-9]{64}$' });

export const StringMap = Type.Record(Type.String(), Type.String());

export const SecretReference = Type.Object(
  {
    env: Type.String({ pattern: '^[A-Z_][A-Z0-9_]*$' }),
  },
  {
    additionalProperties: false,
    description: 'A reference to an environment variable; the secret value is never stored.',
  },
);

export const StringOrSecretReference = Type.Union([Type.String(), SecretReference]);

export const SensitiveStringMap = Type.Record(Type.String(), StringOrSecretReference);
