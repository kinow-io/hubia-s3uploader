# kinow-s3uploader
Hubia s3Uploader - Handle direct multipart upload to S3 through Web/JS UI

## Multipart upload to S3

This class allows you to upload large file to S3 using multipart upload.
Browser client upload directly its file to S3 bucket.

```
    var s3upload = new S3MultipartUpload({
        logging: false,
        partSize: 20 * 1024 * 1024,
        maxSize: 5000 * 1024 * 1024 * 1024,
        temporaryCredentials: true,
        temporaryCredentialsLocation: 'https://backend.domain.com/getCredentials',
        acl: 'private'
    });
```

## AWS S3/STS

Use AWS STS to grand temporary permissions to upload to your S3 bucket.

On backend side, you have to implement AWS STS to allow pushing a specific file (using a key name) inside your S3 bucket:
- https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp.html

Then, return following data to client:

```
[{
    'region' => 'eu-west-1',
    'bucket' => 'my-s3-bucket',
    'Key' => 'temporary-key,
    'AccessKeyId' => 'temporary-access-key_id',
    'SecretAccessKey' => 'temporary-secret-access-key',
    'SessionToken' => 'session-token'
}]
```
