"""Client identity only after the staging Tunnel's loopback transport boundary."""

from ipaddress import ip_address


def loopback_peer(scope):
    peer = scope.get("client")
    if not peer:
        return False
    try:
        return ip_address(peer[0]).is_loopback
    except ValueError:
        return False


def tunnel_client_ip(scope):
    if not loopback_peer(scope):
        raise ValueError("untrusted_ingress")
    values = [
        value
        for name, value in scope.get("headers", [])
        if name.lower() == b"cf-connecting-ip"
    ]
    if len(values) != 1:
        raise ValueError("invalid_client_ip")
    try:
        value = values[0].decode("ascii")
        if value != value.strip() or "%" in value:
            raise ValueError
        address = ip_address(value)
        if address.version == 6 and address.ipv4_mapped:
            address = address.ipv4_mapped
        if address.is_unspecified or address.is_multicast:
            raise ValueError
    except ValueError, UnicodeError:
        raise ValueError("invalid_client_ip") from None
    return str(address)
