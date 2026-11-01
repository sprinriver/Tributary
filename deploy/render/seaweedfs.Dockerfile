# S3-compatible object storage (SeaweedFS). Public, because browsers upload with presigned URLs; every request
# still needs the S3 credentials or a presigned signature.
FROM chrislusf/seaweedfs:4.51
COPY deploy/render/seaweedfs-start.sh /seaweedfs-start.sh
ENV PORT=8333
EXPOSE 8333
ENTRYPOINT ["/bin/sh", "/seaweedfs-start.sh"]
